// Telegram revokes a blob: URL once its message scrolls out of the rendered
// window. Storing the URL and fetching later loses those bytes (53 of 129
// photos in one real run). harvest() must fetch on sight instead.
const assert = require('assert');
const { JSDOM } = (() => { try { return require('jsdom'); } catch { return {}; } })();
if (!JSDOM) { console.log('skip: jsdom not installed'); process.exit(0); }

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');
const src = read('src/content/10-dom.js') + '\n' + read('src/content/20-classify.js');
const grab = n => { const i = src.indexOf(`function ${n}(`); return src.slice(i, src.indexOf('\n}\n', i) + 2); };
const dom = new JSDOM('<body></body>');
global.document = dom.window.document;
// Modules reference siblings via the TG namespace; the eval'd copies
// are bare functions, so point TG at the same global scope.
global.TG = global;

// Blob URLs that can be revoked, mimicking Telegram's behaviour.
const live = new Map();
let nextId = 0;
const makeUrl = bytes => { const u = `blob:tg/${++nextId}`; live.set(u, bytes); return u; };
const revoke = u => live.delete(u);
global.fetch = async u => live.has(u)
  ? { ok: true, blob: async () => ({ size: live.get(u), type: 'image/jpeg' }) }
  : { ok: false, blob: async () => null };

// grab() slices from `function name(`, dropping any `async ` prefix, so re-add
// it. `const` inside eval() is block-scoped and would not escape, hence the
// explicit global assignment.
let h;
eval(grab('durationIn') + grab('bubbleKey') + grab('bubbleOf') + grab('classify')
     + 'h = async ' + grab('harvest'));

const addPhoto = () => {
  const b = dom.window.document.createElement('div');
  b.className = 'bubble';
  const img = dom.window.document.createElement('img');
  const url = makeUrl(2048);
  img.src = url;
  Object.defineProperty(img, 'currentSrc', { value: url });
  Object.defineProperty(img, 'naturalWidth', { value: 800 });
  b.appendChild(img);
  dom.window.document.body.appendChild(b);
  return url;
};

(async () => {
  const found = new Map(), pending = [];

  // Scan pass 1: three photos visible.
  const urls = [addPhoto(), addPhoto(), addPhoto()];
  await h(found, pending);
  assert.strictEqual(found.size, 3, 'all three photos recorded');
  for (const u of urls) assert.ok(found.get(u).blob?.size, `bytes captured for ${u}`);

  // Telegram scrolls them away and revokes the URLs.
  urls.forEach(revoke);
  for (const u of urls)
    assert.ok(found.get(u).blob.size === 2048, 'bytes survive revocation');

  // A photo that was already dead when harvested keeps no blob, and the
  // record still exists so zipAndSave can count it as skipped.
  const dead = addPhoto();
  revoke(dead);
  await h(found, pending);
  assert.ok(found.has(dead), 'dead photo still recorded');
  assert.ok(!found.get(dead).blob, 'no bytes for a revoked URL');

  // Re-harvesting must not refetch what is already captured.
  const before = found.get(urls[0]).blob;
  await h(found, pending);
  assert.strictEqual(found.get(urls[0]).blob, before, 'no duplicate refetch');

  console.log('all 4 harvest checks pass');
})();
