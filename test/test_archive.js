// The naming, numbering and counting rules used to sit inside zipAndSave,
// fused with createObjectURL and a synthetic anchor click — so they could not
// be exercised outside a browser. Those counts are what the user reads at the
// end of a run, and they were wrong twice during development.
//
// buildArchive returns a Blob instead of saving one, so the rules are now
// assertable here.
const assert = require('assert');

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');

// A JSZip stand-in that records what was filed, under what path.
class FakeZip {
  constructor() { this.files = []; }
  file(path, blob) { this.files.push({ path, blob }); }
  async generateAsync() { return { size: this.files.length * 100, type: 'application/zip' }; }
}

const blob = (size = 1000, type = 'image/jpeg') => ({ size, type });

function load({ fetchImpl } = {}) {
  const TG = { chatName: () => 'Test Chat' };
  const zips = [];
  const src = read('src/content/80-archive.js').replace(/^\/\/ --- exports ---[\s\S]*$/m, '');
  const fn = new Function('JSZip', 'TG', 'fetch', 'URL', 'document', 'setTimeout',
    src + '\nreturn { buildArchive, saveBlob, extFor };');
  return {
    api: fn(
      function () { const z = new FakeZip(); zips.push(z); return z; },
      TG,
      fetchImpl || (async () => ({ ok: true, blob: async () => blob() })),
      { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
      { createElement: () => ({ click() {}, remove() {}, style: {} }),
        body: { appendChild() {} } },
      () => {},
    ),
    zips,
  };
}

const report = () => {};

(async () => {
  // --- foldering and numbering ------------------------------------------
  let { api, zips } = load();
  let r = await api.buildArchive([
    { kind: 'photo', blob: blob() },
    { kind: 'photo', blob: blob() },
    { kind: 'video', blob: blob(2000, 'video/mp4') },
  ], report);

  const paths = zips[0].files.map(f => f.path);
  assert.deepStrictEqual(paths, [
    'photo/photo_0001.jpg',
    'photo/photo_0002.jpg',
    'video/video_0001.mp4',
  ], 'one folder per kind, numbered from 0001 within each kind');

  assert.deepStrictEqual(r.counts, { photo: 2, video: 1 }, 'counts are per kind');
  assert.strictEqual(r.total, 3, 'total counts every filed item');
  assert.strictEqual(r.failed, 0, 'nothing failed');

  // Numbering is per kind, not global — this is the rule most likely to rot.
  ({ api, zips } = load());
  await api.buildArchive([
    { kind: 'photo', blob: blob() }, { kind: 'video', blob: blob() },
    { kind: 'photo', blob: blob() }, { kind: 'video', blob: blob() },
  ], report);
  assert.deepStrictEqual(zips[0].files.map(f => f.path), [
    'photo/photo_0001.jpg', 'video/video_0001.jpg',
    'photo/photo_0002.jpg', 'video/video_0002.jpg',
  ], 'interleaved kinds each keep their own sequence');

  // --- zero-size blobs are skipped and counted, not filed ---------------
  ({ api, zips } = load());
  r = await api.buildArchive([
    { kind: 'photo', blob: blob() },
    { kind: 'photo', blob: blob(0) },      // revoked between scan and fetch
    { kind: 'photo', blob: blob() },
  ], report);
  assert.strictEqual(r.total, 2, 'the empty blob is not counted as saved');
  assert.strictEqual(r.failed, 1, 'it is reported as failed');
  assert.strictEqual(zips[0].files.length, 2, 'and not filed into the archive');
  assert.deepStrictEqual(zips[0].files.map(f => f.path),
    ['photo/photo_0001.jpg', 'photo/photo_0002.jpg'],
    'numbering closes the gap rather than leaving a hole');

  // --- a failed fetch is skipped, and the run continues ------------------
  let calls = 0;
  ({ api, zips } = load({ fetchImpl: async () => {
    calls++;
    if (calls === 2) return { ok: false, status: 404 };
    return { ok: true, blob: async () => blob() };
  } }));
  r = await api.buildArchive([
    { kind: 'photo', url: 'blob:a' },
    { kind: 'photo', url: 'blob:b' },     // 404
    { kind: 'photo', url: 'blob:c' },
  ], report);
  assert.strictEqual(r.total, 2, 'the failure did not stop the run');
  assert.strictEqual(r.failed, 1, 'and was counted');

  // --- pre-fetched blobs skip the network entirely -----------------------
  let fetched = 0;
  ({ api } = load({ fetchImpl: async () => { fetched++; return { ok: true, blob: async () => blob() }; } }));
  await api.buildArchive([{ kind: 'video', blob: blob(5000, 'video/mp4') }], report);
  assert.strictEqual(fetched, 0, 'a pre-fetched video is not re-fetched');

  // --- nothing usable is an error, not a silent empty zip ---------------
  ({ api } = load());
  await assert.rejects(
    () => api.buildArchive([{ kind: 'photo', blob: blob(0) }], report),
    /Nothing could be downloaded/,
    'an archive with no files throws rather than saving an empty zip');

  // --- progress is reported per item, then once for zipping -------------
  const phases = [];
  ({ api } = load());
  await api.buildArchive(
    [{ kind: 'photo', blob: blob() }, { kind: 'photo', blob: blob() }],
    p => phases.push(p.phase));
  assert.deepStrictEqual(phases, ['downloading', 'downloading', 'zipping'],
    'one downloading tick per item, then zipping');

  // --- buildArchive does no browser IO ----------------------------------
  // The whole point of the split: saving is somewhere else.
  const body = read('src/content/80-archive.js');
  const build = body.slice(body.indexOf('async function buildArchive'),
                           body.indexOf('function saveBlob'));
  assert.ok(!/createObjectURL|document\.createElement|\.click\(\)/.test(build),
    'buildArchive performs no browser IO — that is what makes it testable');
  assert.ok(/createObjectURL/.test(body.slice(body.indexOf('function saveBlob'))),
    'saveBlob is where the browser IO lives');

  console.log('all 20 archive checks pass');
})();
