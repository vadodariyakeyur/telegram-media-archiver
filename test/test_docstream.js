// Building a document's /stream/ URL from its row.
//
// Every constant here was established empirically against a live service
// worker (see the probe history): raw JSON not base64, a nested `location`
// wrapper, and `size` mandatory. Each has a failing-SW signature if broken.
const assert = require('assert');
const { JSDOM } = (() => { try { return require('jsdom'); } catch { return {}; } })();
if (!JSDOM) { console.log('skip: jsdom not installed'); process.exit(0); }

const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src/content/20-classify.js'), 'utf8');
const grab = name => {
  const at = src.indexOf(`function ${name}(`);
  return src.slice(at, src.indexOf('\n}\n', at) + 3);
};

const dom = new JSDOM('<body></body>', { url: 'https://web.telegram.org/k/' });
global.document = dom.window.document;
global.location = dom.window.location;
global.TG = { safeName: r => r.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) };
eval(grab('docNameIn') + grab('docSizeIn') + grab('docStreamUrl'));

const row = html => { const d = dom.window.document.createElement('div'); d.innerHTML = html; return d; };

// The real markup, from the probe.
const REAL = `<div class="document ext-mkv" data-doc-id="5979052611603535768">
  <div class="document-name"><middle-ellipsis-element title="[@Anime_RTX] [S02-E12] Solo Leveling [HDRIP] [Sub].mkv">[@Anime_RTX] [S…RIP] [Sub].mkv</middle-ellipsis-element></div>
  <div class="document-size"><span><span class="i18n">1.35 GB</span> · <span> / <span class="i18n">1.35 GB</span></span></span></div>
</div>`;

// The displayed text is middle-ellipsised; the title holds the real name. A
// literal "…" in a filename is the symptom of reading textContent.
assert.strictEqual(docNameIn(row(REAL)),
  '[@Anime_RTX] [S02-E12] Solo Leveling [HDRIP] [Sub].mkv', 'full name comes from title');
assert.ok(!docNameIn(row(REAL)).includes('…'), 'no ellipsis in the archived name');

// Falls back to text when no title attribute exists.
assert.strictEqual(docNameIn(row('<div class="document-name">notes.txt</div>')), 'notes.txt',
  'plain row still yields a name');

assert.strictEqual(docSizeIn(row(REAL)), 1350000000, '1.35 GB parses to bytes');
assert.strictEqual(docSizeIn(row('<div class="document-size">42 KB</div>')), 42000, 'KB');
assert.strictEqual(docSizeIn(row('<div class="document-size">7 B</div>')), 7, 'bytes');
// Rounded up: an under-estimate truncates the download, an over-estimate is
// corrected by the server's Content-Range.
assert.strictEqual(docSizeIn(row('<div class="document-size">1.5 MB</div>')), 1500000, 'MB');
assert.strictEqual(docSizeIn(row('<div class="document-size">no size here</div>')), null, 'unparsable -> null');

const url = docStreamUrl(row(REAL));
assert.ok(url.startsWith('https://web.telegram.org/stream/'), 'stream route');

const json = decodeURIComponent(url.slice(url.indexOf('/stream/') + 8));
// RAW json, not base64: the worker JSON.parse'd our path directly and threw
// "Unexpected token 'e'" on a base64 string.
const p = JSON.parse(json);
assert.strictEqual(p.location._, 'inputDocumentFileLocation');
// A BARE location (no wrapper) crashed the worker at getDocId reading .id of
// undefined, so the nesting is load-bearing.
assert.strictEqual(p.location.id, '5979052611603535768', 'doc id nested under location');
assert.strictEqual(p.size, 1350000000, 'size is present and exact');
assert.ok('dcId' in p, 'dcId present (value ignored by the worker, field is not)');
assert.strictEqual(p.fileName, '[@Anime_RTX] [S02-E12] Solo Leveling [HDRIP] [Sub].mkv');

// Missing either input means no URL rather than one the worker will reject.
assert.strictEqual(docStreamUrl(row('<div class="document-size">1 GB</div>')), null, 'no doc-id -> null');
assert.strictEqual(docStreamUrl(row('<div data-doc-id="123"></div>')), null, 'no size -> null');

console.log('all 14 document-stream checks pass');
