// Self-check for the chunked Range fetch. Runs with a fake fetch; the real
// thing talks to Telegram, so this only exercises the assembly logic.
//
// fetchRanged runs in the page's MAIN-world context (entrypoints/page-bridge.content.ts)
// so it can reach Telegram's own service worker — a content-script fetch runs
// isolated and gets an unreadable 302. It is not exported (only the
// defineContentScript's main() closes over it), so it is sliced out of the
// source and evaluated directly, same as the file's own postMessage transport.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const src = readFileSync(join(ROOT, 'entrypoints/page-bridge.content.ts'), 'utf8');
const body = src.slice(src.indexOf('async function fetchRanged'), src.indexOf('window.addEventListener'));
// new Function only takes JS, so strip every TS-only annotation this function
// uses: the return type, parameter types, and typed local declarations.
const fnSrc = body
  .replace(/\): Promise<\{ buffer: ArrayBuffer; mime: string \| null \}> \{/, ') {')
  .replace(/\(url: string, id: string\)/, '(url, id)')
  .replace(/const parts: ArrayBuffer\[\] = \[\];/, 'const parts = [];')
  .replace(/let offset = 0, total: number \| null = null, mime: string \| null = null;/,
    'let offset = 0, total = null, mime = null;');

let posted: unknown[] = [];
const TAG = 'tg-dl';
// new Function doesn't close over this file's scope, so TAG (a module-level
// const in the real file, outside the sliced function) must be passed in too.
const fetchRanged: (url: string, id: string) => Promise<{ buffer: ArrayBuffer; mime: string | null }> =
  new Function('window', 'TAG', `"use strict"; ${fnSrc} return fetchRanged;`)(
    { postMessage: (m: unknown) => posted.push(m) }, TAG,
  );

type Fetch = typeof fetch;

const server = (size: number, chunk: number, opts: { lieFrom?: number; lieTotal?: number } = {}): Fetch =>
  (async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const from = +/bytes=(\d+)-/.exec(headers.Range)![1];
    const end = Math.min(from + chunk, size) - 1;
    const n = end - from + 1;
    return {
      ok: true, status: 206,
      headers: { get: (h: string) => h === 'Content-Range'
        ? `bytes ${opts.lieFrom ?? from}-${end}/${opts.lieTotal ?? size}` : null },
      arrayBuffer: async () => new ArrayBuffer(n),
    };
  }) as unknown as Fetch;

beforeEach(() => { posted = []; });

describe('fetchRanged', () => {
  it('assembles a multi-chunk file to the full size', async () => {
    global.fetch = server(1000, 300);
    const b = await fetchRanged('u', '1');
    expect(b.buffer.byteLength).toBe(1000);
  });

  // No Content-Type from this server, and the fetch no longer assumes one:
  // the same pass now carries documents and audio, which a video/mp4 default
  // mislabelled. The archive picks an extension from the kind instead.
  it('mime is unset when the server sends none', async () => {
    global.fetch = server(1000, 300);
    const b = await fetchRanged('u', '1');
    expect(b.mime).toBe(null);
  });

  it('an exact multiple of the chunk size does not loop forever or over-read', async () => {
    global.fetch = server(900, 300);
    expect((await fetchRanged('u', '1')).buffer.byteLength).toBe(900);
  });

  it('a single-shot response smaller than one chunk is handled', async () => {
    global.fetch = server(150, 300);
    expect((await fetchRanged('u', '1')).buffer.byteLength).toBe(150);
  });

  it('progress reports reach the total', async () => {
    global.fetch = server(1000, 250);
    await fetchRanged('u', 'id1');
    const prog = posted.filter((m): m is Record<string, unknown> =>
      !!m && typeof m === 'object' && (m as Record<string, unknown>)[TAG] === 'progress');
    expect(prog.length).toBeGreaterThanOrEqual(2);
    expect(prog[prog.length - 1].got).toBe(1000);
    expect(prog[prog.length - 1].total).toBe(1000);
  });

  it('a server that lies about the offset throws rather than stitching bad bytes', async () => {
    global.fetch = server(1000, 300, { lieFrom: 99 });
    await expect(fetchRanged('u', '1')).rejects.toThrow(/offset mismatch/i);
  });

  it('the total size changing mid-download throws', async () => {
    let call = 0;
    global.fetch = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const from = +/bytes=(\d+)-/.exec(headers.Range)![1];
      const total = ++call > 1 ? 2000 : 1000;
      return {
        ok: true, status: 206,
        headers: { get: (h: string) => h === 'Content-Range' ? `bytes ${from}-${from + 299}/${total}` : null },
        arrayBuffer: async () => new ArrayBuffer(300),
      };
    }) as unknown as Fetch;
    await expect(fetchRanged('u', '1')).rejects.toThrow(/size changed/i);
  });

  // Redirects are no longer chased here: this file runs in the page's own
  // context, so Telegram's service worker resolves /stream/ URLs before fetch()
  // ever sees them. A non-2xx status here means the service worker didn't
  // handle it — a real failure that must surface, not be followed.
  it('an unhandled non-2xx status surfaces rather than being chased', async () => {
    global.fetch = (async () => ({
      ok: false, status: 302,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as Fetch;
    await expect(fetchRanged('https://web.telegram.org/stream/1', '1')).rejects.toThrow(/HTTP 302/);
  });

  it('a genuine error status surfaces', async () => {
    global.fetch = (async () => ({
      ok: false, status: 403,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as Fetch;
    await expect(fetchRanged('https://web.telegram.org/s/3', '1')).rejects.toThrow(/HTTP 403/);
  });
});
