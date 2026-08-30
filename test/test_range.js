// Self-check for the chunked Range fetch. Runs in node with a fake fetch;
// the real thing talks to Telegram, so this only exercises the assembly logic.
const assert = require('assert');
// fetchRanged now lives in page_fetch.js (it must run in the page's context to
// reach Telegram's service worker), so test it there.
const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');
const src = read('src/page/fetch-bridge.js');
const fn = src.slice(src.indexOf('async function fetchRanged'),
                     src.indexOf('  window.addEventListener'));
let posted = [];
global.window = { postMessage: m => posted.push(m) };
const TAG = 'tg-dl';                    // closure constant from page_fetch.js
const fetchRanged = eval(`(${fn.trim().replace(/\}\s*$/, '}')})`);

// Serve `size` bytes in `chunk`-sized pieces, honouring the Range header.
const server = (size, chunk, opts = {}) => async (url, init) => {
  const from = +/bytes=(\d+)-/.exec(init.headers.Range)[1];
  const end = Math.min(from + chunk, size) - 1;
  const n = end - from + 1;
  return {
    ok: true, status: 206,
    headers: { get: h => h === 'Content-Range'
      ? `bytes ${opts.lieFrom ?? from}-${end}/${opts.lieTotal ?? size}` : null },
    arrayBuffer: async () => new ArrayBuffer(n),
  };
};

(async () => {
  // Multi-chunk file assembles to the full size.
  global.fetch = server(1000, 300);
  const b = await fetchRanged('u');
  assert.strictEqual(b.buffer.byteLength, 1000, 'multi-chunk size');
  assert.strictEqual(b.mime, 'video/mp4', 'mime preserved');

  // Exact multiple of chunk size must not loop forever or over-read.
  global.fetch = server(900, 300);
  assert.strictEqual((await fetchRanged('u')).buffer.byteLength, 900, 'exact multiple');

  // Single-shot smaller than one chunk.
  global.fetch = server(150, 300);
  assert.strictEqual((await fetchRanged('u')).buffer.byteLength, 150, 'single chunk');

  // Progress reports reach the total.
  global.fetch = server(1000, 250);
  posted = [];
  await fetchRanged('u');
  const prog = posted.filter(m => m[TAG] === 'progress');
  assert.ok(prog.length >= 2, 'progress reported per chunk');
  assert.strictEqual(prog[prog.length - 1].got, 1000, 'progress reaches total');
  assert.strictEqual(prog[prog.length - 1].total, 1000, 'total reported');

  // A server that lies about the offset must throw, not stitch bad bytes.
  global.fetch = server(1000, 300, { lieFrom: 99 });
  await assert.rejects(() => fetchRanged('u'), /offset mismatch/, 'offset guard');

  // Total size changing mid-download must throw.
  let call = 0;
  global.fetch = async (url, init) => {
    const from = +/bytes=(\d+)-/.exec(init.headers.Range)[1];
    const total = ++call > 1 ? 2000 : 1000;   // size shifts on the 2nd request
    return { ok: true, status: 206,
      headers: { get: h => h === 'Content-Range' ? `bytes ${from}-${from + 299}/${total}`
                                 : h === 'Content-Type' ? 'video/mp4' : null },
      arrayBuffer: async () => new ArrayBuffer(300) };
  };
  await assert.rejects(() => fetchRanged('u'), /Size changed/, 'size-change guard');

  // Redirects are no longer chased here. page_fetch.js runs in the page's own
  // context, so Telegram's service worker resolves /stream/ URLs before fetch()
  // ever sees them. A 302 arriving at this layer means the service worker did
  // not handle it, which is a real failure and must surface, not be followed.
  global.fetch = async () => ({
    ok: false, status: 302,
    headers: { get: h => h === 'Location' ? 'https://cdn.example/real.mp4' : null },
    arrayBuffer: async () => new ArrayBuffer(0) });
  await assert.rejects(() => fetchRanged('https://web.telegram.org/stream/1'),
                       /HTTP 302/, 'unhandled 302 surfaces rather than being chased');

  // A genuine error status still throws.
  global.fetch = async () => ({ ok: false, status: 403,
    headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
  await assert.rejects(() => fetchRanged('https://web.telegram.org/s/3'), /HTTP 403/, 'real error surfaces');

  console.log('all range-fetch checks pass');
})();
