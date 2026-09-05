#!/usr/bin/env -S pnpm exec tsx
// Structural checks the test suites cannot cover: naming drift across
// surfaces, icon pixel dimensions, and panel asset/CSP references. Manifest
// validity and module load order are no longer checked here — WXT generates
// the manifest from wxt.config.ts, and Vite fails the build outright on an
// unresolved import, so both failure classes the old checker existed for are
// now compile-time errors instead of a separate script's job.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NAME from './naming';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p: string) => path.join(ROOT, p);
const problems: string[] = [];
const fail = (m: string) => problems.push(m);

// --- naming ----------------------------------------------------------------
// One source of truth (tools/naming.ts). The repo previously carried six
// variants of the name across manifest, package, panel and README, so every
// surface is checked against it rather than trusted to stay in sync.
const configSrc = fs.readFileSync(rel('wxt.config.ts'), 'utf8');
const cfgName = configSrc.match(/name:\s*'([^']*)'/)?.[1];
const cfgDescription = configSrc.match(/description:\s*'([^']*)'/)?.[1];
if (cfgName !== NAME.product) fail(`wxt.config.ts manifest.name is "${cfgName}", expected "${NAME.product}"`);
if (cfgDescription !== NAME.description) fail('wxt.config.ts manifest.description does not match naming.ts');

const pkg = JSON.parse(fs.readFileSync(rel('package.json'), 'utf8'));
if (pkg.name !== NAME.slug) fail(`package.json name is "${pkg.name}", expected "${NAME.slug}"`);
if (pkg.description !== NAME.description) fail('package.json description does not match naming.ts');

const indexHtml = fs.readFileSync(rel('entrypoints/sidepanel/index.html'), 'utf8');
const title = indexHtml.match(/<title>([^<]*)<\/title>/)?.[1];
if (title !== NAME.product) fail(`panel <title> is "${title}", expected "${NAME.product}"`);

const appTsx = fs.readFileSync(rel('entrypoints/sidepanel/App.tsx'), 'utf8');
const h1 = appTsx.match(/<h1>([^<]*)<\/h1>/)?.[1];
if (h1 !== NAME.short) fail(`panel <h1> is "${h1}", expected "${NAME.short}"`);

const readmeHead = fs.readFileSync(rel('README.md'), 'utf8').split('\n')[0];
if (readmeHead !== `# ${NAME.product}`) fail(`README heading is "${readmeHead}", expected "# ${NAME.product}"`);

// --- icons -------------------------------------------------------------
// Chrome silently falls back to a grey puzzle piece when these are missing or
// the wrong size, so verify the declarations AND the actual pixel dimensions.
function pngSize(file: string): { w: number; h: number } | null {
  const b = fs.readFileSync(file);
  // PNG: 8-byte signature, then IHDR length+type, then width/height at 16..24.
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const iconsMatch = configSrc.match(/icons:\s*{([^}]*)}/);
const icons: Record<string, string> = {};
if (iconsMatch) {
  for (const m of iconsMatch[1].matchAll(/(\d+):\s*'([^']*)'/g)) icons[m[1]] = m[2];
}
if (!Object.keys(icons).length) fail('wxt.config.ts manifest.icons missing: Chrome will show a default puzzle piece');
// Manifest icon paths are resolved against the build output root, where
// public/ is copied in flattened — so the source file lives in public/, not
// at the manifest path itself.
for (const [size, p] of Object.entries(icons)) {
  const src = rel(path.join('public', p));
  if (!fs.existsSync(src)) { fail(`icons[${size}] missing file: public/${p}`); continue; }
  const dim = pngSize(src);
  if (!dim) fail(`icons[${size}] is not a valid PNG: ${p}`);
  else if (dim.w !== +size || dim.h !== +size) fail(`icons[${size}] is ${dim.w}x${dim.h}, expected ${size}x${size}`);
}
for (const s of ['16', '48', '128']) {
  if (!icons[s]) fail(`icons is missing the ${s}px size Chrome asks for`);
}

// --- panel assets ------------------------------------------------------
// MV3's default CSP blocks remote scripts and stylesheets outright.
if (/<link[^>]+href="https?:/.test(indexHtml)) fail('remote stylesheet blocked by MV3 CSP');
for (const m of indexHtml.matchAll(/src="([^"]+)"/g)) {
  if (/^https?:/.test(m[1])) fail(`remote script blocked by MV3 CSP: ${m[1]}`);
}

// --- report --------------------------------------------------------------
if (problems.length) {
  console.error('FAILED\n' + problems.map(p => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log(`ok  naming in sync, ${Object.keys(icons).length} icons valid, panel assets clean`);
