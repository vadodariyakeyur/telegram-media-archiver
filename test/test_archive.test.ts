// The naming, numbering and counting rules used to sit inside zipAndSave,
// fused with createObjectURL and a synthetic anchor click — so they could not
// be exercised outside a browser. Those counts are what the user reads at the
// end of a run, and they were wrong twice during development.
//
// buildArchive returns a Blob instead of saving one, so the rules are assertable
// here. jszip is real code the module imports directly (not injectable), so a
// fake JSZip is substituted via vi.mock to make the zip's file paths observable.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

class FakeZip {
  files: { path: string; blob: unknown }[] = [];
  file(path: string, blob: unknown) { this.files.push({ path, blob }); }
  async generateAsync() { return new Blob([new Uint8Array(this.files.length * 100)]); }
}
let zips: FakeZip[];
vi.mock('jszip', () => ({ default: vi.fn(() => { const z = new FakeZip(); zips.push(z); return z; }) }));

const { buildArchive } = await import('../tw-sdk/archive');

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const blob = (size = 1000, type = 'image/jpeg') => new Blob([new Uint8Array(size)], { type });
const report = () => {};

beforeEach(() => { zips = []; vi.stubGlobal('fetch', undefined); });

describe('buildArchive', () => {
  it('one folder per kind, numbered from 0001 within each kind', async () => {
    const r = await buildArchive([
      { kind: 'photo', blob: blob() },
      { kind: 'photo', blob: blob() },
      { kind: 'video', blob: blob(2000, 'video/mp4') },
    ], report);

    const paths = zips[0].files.map(f => f.path);
    expect(paths).toEqual([
      'photo/photo_0001.jpg',
      'photo/photo_0002.jpg',
      'video/video_0001.mp4',
    ]);
    expect(r.counts).toEqual({ photo: 2, video: 1 });
    expect(r.total).toBe(3);
    expect(r.failed).toBe(0);
  });

  // Numbering is per kind, not global — this is the rule most likely to rot.
  it('interleaved kinds each keep their own sequence', async () => {
    await buildArchive([
      { kind: 'photo', blob: blob() }, { kind: 'video', blob: blob() },
      { kind: 'photo', blob: blob() }, { kind: 'video', blob: blob() },
    ], report);
    expect(zips[0].files.map(f => f.path)).toEqual([
      'photo/photo_0001.jpg', 'video/video_0001.jpg',
      'photo/photo_0002.jpg', 'video/video_0002.jpg',
    ]);
  });

  it('zero-size blobs are skipped and counted, not filed; numbering closes the gap', async () => {
    const r = await buildArchive([
      { kind: 'photo', blob: blob() },
      { kind: 'photo', blob: blob(0) },      // revoked between scan and fetch
      { kind: 'photo', blob: blob() },
    ], report);
    expect(r.total).toBe(2);
    expect(r.failed).toBe(1);
    expect(zips[0].files.length).toBe(2);
    expect(zips[0].files.map(f => f.path)).toEqual(
      ['photo/photo_0001.jpg', 'photo/photo_0002.jpg']);
  });

  it('a failed fetch is skipped, and the run continues', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      if (calls === 2) return { ok: false, status: 404 };
      return { ok: true, blob: async () => blob() };
    });
    const r = await buildArchive([
      { kind: 'photo', url: 'blob:a' },
      { kind: 'photo', url: 'blob:b' },     // 404
      { kind: 'photo', url: 'blob:c' },
    ], report);
    expect(r.total).toBe(2);
    expect(r.failed).toBe(1);
  });

  it('a pre-fetched blob skips the network entirely', async () => {
    let fetched = 0;
    vi.stubGlobal('fetch', async () => { fetched++; return { ok: true, blob: async () => blob() }; });
    await buildArchive([{ kind: 'video', blob: blob(5000, 'video/mp4') }], report);
    expect(fetched).toBe(0);
  });

  it('nothing usable is an error, not a silent empty zip', async () => {
    await expect(buildArchive([{ kind: 'photo', blob: blob(0) }], report))
      .rejects.toThrow(/Nothing could be downloaded/);
  });

  it('progress is reported per item, then once for zipping', async () => {
    const phases: string[] = [];
    await buildArchive(
      [{ kind: 'photo', blob: blob() }, { kind: 'photo', blob: blob() }],
      p => phases.push(p.phase));
    expect(phases).toEqual(['downloading', 'downloading', 'zipping']);
  });

  it('the document name reaches the zip path, not just the naming helper', async () => {
    await buildArchive([{ kind: 'file', blob: blob(10, ''), name: 'notes.txt' }], report);
    expect(zips[0].files[0].path).toBe('file/notes_0001.txt');
  });

  // The whole point of the split: saving is somewhere else (saveBlob).
  it('performs no browser IO', () => {
    const body = read('tw-sdk/archive.ts');
    const build = body.slice(body.indexOf('export async function buildArchive'),
                             body.indexOf('function saveBlob'));
    expect(/createObjectURL|document\.createElement|\.click\(\)/.test(build)).toBe(false);
    expect(/createObjectURL/.test(body.slice(body.indexOf('function saveBlob')))).toBe(true);
  });
});

// extFor/nameFor are private helpers now (only buildArchive/zipAndSave are
// exported), so their rules are asserted through the zip paths buildArchive
// produces rather than by calling them directly.
describe('extension and naming rules, observed through buildArchive', () => {
  // A missing entry silently fell through to .jpg, which would have shipped
  // round videos and music as images.
  it.each(Object.entries({
    photo: 'jpg', video: 'mp4', gif: 'mp4', round: 'mp4',
    sticker: 'jpg', voice: 'ogg', music: 'mp3', file: 'bin',
  }))('%s with no mime falls back to .%s', async (kind, ext) => {
    await buildArchive([{ kind: kind as never, blob: blob(10, '') }], report);
    expect(zips[0].files[0].path).toBe(`${kind}/${kind}_0001.${ext}`);
  });

  it('a real mime always beats the per-kind fallback', async () => {
    await buildArchive([{ kind: 'file', blob: blob(10, 'audio/mpeg') }], report);
    expect(zips[0].files[0].path).toBe('file/file_0001.mp3');
  });

  // Telegram's own filename is the point of downloading a document at all, but
  // two chats can send the same name, so the sequence number must survive.
  it('document keeps its name and extension', async () => {
    await buildArchive([{ kind: 'file', blob: blob(10, ''), name: 'report.pdf' }], report);
    expect(zips[0].files[0].path).toBe('file/report_0001.pdf');
  });
  it('only the last dot splits the extension', async () => {
    await buildArchive([{ kind: 'file', blob: blob(10, ''), name: 'archive.tar.gz' }], report);
    expect(zips[0].files[0].path).toBe('file/archive.tar_0001.gz');
  });
  it('extensionless name still gets one', async () => {
    await buildArchive([{ kind: 'file', blob: blob(10, ''), name: 'LICENSE' }], report);
    expect(zips[0].files[0].path).toBe('file/LICENSE_0001.bin');
  });
  // A leading dot is the whole name, not an empty stem with an extension.
  it('a dotfile is not split', async () => {
    await buildArchive([{ kind: 'file', blob: blob(10, ''), name: '.gitignore' }], report);
    expect(zips[0].files[0].path).toBe('file/.gitignore_0001.bin');
  });
});
