#!/usr/bin/env node
// Structural checks the test suites cannot cover: manifest validity, module
// load order, cross-module symbol resolution, and asset paths. These are the
// failures that only surface when Chrome loads the extension, so they are
// worth catching from the shell.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rel = p => path.join(ROOT, p);
const problems = [];
const fail = m => problems.push(m);

// --- manifest ------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(rel('manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest_version must be 3');

const declared = [];
for (const cs of manifest.content_scripts || []) {
  for (const j of cs.js) {
    declared.push(j);
    if (!fs.existsSync(rel(j))) fail(`manifest lists missing file: ${j}`);
  }
}
// side_panel, not action.default_popup: this extension opens a side panel, and
// reading the popup key gave undefined — which crashed rel() below before any
// of these checks could report anything.
const panel = manifest.side_panel?.default_path || manifest.action?.default_popup;
if (!panel || !fs.existsSync(rel(panel))) {
  // Every check below reads this file, so there is nothing left to verify.
  console.error(`FAILED\n  - missing panel/popup: ${panel}`);
  process.exit(1);
}

// The MAIN-world bridge must load at document_start, before the page's own
// service-worker-backed media requests begin.
const main = (manifest.content_scripts || []).find(c => c.world === 'MAIN');
if (!main) fail('no MAIN-world content script: video fetches will get a 302');
else if (main.run_at !== 'document_start') fail('MAIN-world script must run at document_start');

// --- content module graph -------------------------------------------------
const mods = declared.filter(p => p.startsWith('src/content/'));
const defined = new Map([['sleep', '00-namespace.js']]);
const uses = [];

mods.forEach((p, i) => {
  const base = path.basename(p);
  const src = fs.readFileSync(rel(p), 'utf8');
  const [body, exports = ''] = src.split('// --- exports ---');
  for (const m of exports.matchAll(/^TG\.(\w+)\s*=/gm)) defined.set(m[1], base);
  // Only TOP-LEVEL references run at load time. A TG.* call inside a function
  // or method body runs when that function is invoked — long after every
  // module has loaded — so counting it as a load-time use produces false
  // load-order failures. Track brace depth to tell the two apart.
  let depth = 0;
  for (const line of body.split('\n')) {
    const code = line.replace(/\/\/.*$/, '');
    if (!line.trim().startsWith('//')) {
      for (const m of code.matchAll(/TG\.(\w+)/g)) {
        uses.push({ base, sym: m[1], i, deferred: depth > 0 });
      }
    }
    // Count braces outside strings well enough for this purpose; the files
    // here are plain enough that a stricter parse would not pay for itself.
    depth += (code.match(/{/g) || []).length - (code.match(/}/g) || []).length;
    if (depth < 0) depth = 0;
  }
});

const order = new Map(mods.map((p, i) => [path.basename(p), i]));
order.set('00-namespace.js', -1);
for (const { base, sym, i, deferred } of uses) {
  // An undefined symbol is a bug wherever it appears.
  if (!defined.has(sym)) { fail(`${base}: TG.${sym} is never defined`); continue; }
  // Load order only constrains top-level references.
  if (deferred) continue;
  const owner = defined.get(sym);
  if (order.get(owner) > i) fail(`${base}: uses TG.${sym} before ${owner} loads`);
}

// --- naming ---------------------------------------------------------------
// One source of truth (tools/naming.js). The repo previously carried six
// variants of the name across manifest, package, popup and README, so every
// surface is checked against it rather than trusted to stay in sync.
const NAME = require('./naming.js');
const pkg = JSON.parse(fs.readFileSync(rel('package.json'), 'utf8'));

if (manifest.name !== NAME.product)
  fail(`manifest.name is "${manifest.name}", expected "${NAME.product}"`);
if (manifest.description !== NAME.description)
  fail('manifest.description does not match naming.js');
if (manifest.action?.default_title !== NAME.short)
  fail(`action.default_title is "${manifest.action?.default_title}", expected "${NAME.short}"`);
if (pkg.name !== NAME.slug)
  fail(`package.json name is "${pkg.name}", expected "${NAME.slug}"`);
if (pkg.description !== NAME.description)
  fail('package.json description does not match naming.js');

const panelHtml = fs.readFileSync(rel(panel), 'utf8');
const title = panelHtml.match(/<title>([^<]*)<\/title>/)?.[1];
const h1 = panelHtml.match(/<h1>([^<]*)<\/h1>/)?.[1];
if (title !== NAME.product) fail(`panel <title> is "${title}", expected "${NAME.product}"`);
if (h1 !== NAME.short) fail(`panel <h1> is "${h1}", expected "${NAME.short}"`);

const readmeHead = fs.readFileSync(rel('README.md'), 'utf8').split('\n')[0];
if (readmeHead !== `# ${NAME.product}`)
  fail(`README heading is "${readmeHead}", expected "# ${NAME.product}"`);

// --- icons ----------------------------------------------------------------
// Chrome silently falls back to a grey puzzle piece when these are missing or
// the wrong size, so verify the declarations AND the actual pixel dimensions.
function pngSize(file) {
  const b = fs.readFileSync(file);
  // PNG: 8-byte signature, then IHDR length+type, then width/height at 16..24.
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const iconSets = [['icons', manifest.icons],
                  ['action.default_icon', manifest.action?.default_icon]];
for (const [label, set] of iconSets) {
  if (!set) { fail(`${label} missing: Chrome will show a default puzzle piece`); continue; }
  for (const [size, p] of Object.entries(set)) {
    if (!fs.existsSync(rel(p))) { fail(`${label}[${size}] missing file: ${p}`); continue; }
    const dim = pngSize(rel(p));
    if (!dim) fail(`${label}[${size}] is not a valid PNG: ${p}`);
    else if (dim.w !== +size || dim.h !== +size)
      fail(`${label}[${size}] is ${dim.w}x${dim.h}, expected ${size}x${size}`);
  }
}
for (const s of ['16', '48', '128']) {
  if (!manifest.icons?.[s]) fail(`icons is missing the ${s}px size Chrome asks for`);
}

// --- panel assets ---------------------------------------------------------
const panelDir = path.dirname(rel(panel));
const html = fs.readFileSync(rel(panel), 'utf8');
for (const m of html.matchAll(/url\('([^']+)'\)/g)) {
  if (!fs.existsSync(path.resolve(panelDir, m[1]))) fail(`panel asset missing: ${m[1]}`);
}
for (const m of html.matchAll(/src="([^"]+)"/g)) {
  if (/^https?:/.test(m[1])) fail(`remote script blocked by MV3 CSP: ${m[1]}`);
  else if (!fs.existsSync(path.resolve(panelDir, m[1]))) fail(`panel script missing: ${m[1]}`);
}
// MV3's default CSP blocks remote stylesheets and fonts outright.
if (/<link[^>]+href="https?:/.test(html)) fail('remote stylesheet blocked by MV3 CSP');

// --- report ---------------------------------------------------------------
if (problems.length) {
  console.error('FAILED\n' + problems.map(p => '  - ' + p).join('\n'));
  process.exit(1);
}
const nIcons = Object.keys(manifest.icons || {}).length;
console.log(`ok  manifest v3, ${mods.length} content modules, ` +
            `${defined.size} exported symbols, ${nIcons} icons, assets resolve`);
