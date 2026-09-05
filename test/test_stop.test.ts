// Stopping a scan must KEEP what it collected — that is the whole point of the
// button. A chat switch (Cancelled) must still discard, because that result
// would be a mix of two chats. The two signals are deliberately different.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let openChat = 'peer:aaa';
vi.mock('../tw-sdk/dom', () => ({
  chatKey: () => openChat,
  findScroller: () => null,
  glideTo: vi.fn(async () => {}),
}));
vi.mock('../tw-sdk/locate', () => ({ refind: vi.fn(async (entry: { bubble: unknown }) => entry.bubble) }));
vi.mock('../tw-sdk/viewer', () => ({
  openForSrc: vi.fn(async (b: { id: string }) => `https://x/stream/${b.id}`),
  closeViewer: vi.fn(() => {}),
}));
vi.mock('../tw-sdk/classify', () => ({ docStreamUrl: (b: { id: string }) => `https://x/stream/${b.id}` }));
vi.mock('../tw-sdk/utils', () => ({ sleep: () => Promise.resolve() }));

const { startRun, Cancelled, Stopped } = await import('../tw-sdk/run');
const { loadPending } = await import('../entrypoints/content/collect');
const bridge = await import('../entrypoints/content/bridge');

beforeEach(() => { openChat = 'peer:aaa'; vi.restoreAllMocks(); });

describe('stop vs cancel', () => {
  it('the two signals are distinguishable', () => {
    expect(new Stopped()).toBeInstanceOf(Error);
    expect(new Stopped().name).toBe('Stopped');
    expect(new Stopped()).not.toBeInstanceOf(Cancelled);
    expect(new Cancelled()).not.toBeInstanceOf(Stopped);
  });

  it('pause() raises Stopped on request', async () => {
    let run = startRun('peer:aaa');
    await expect(run.pause(1)).resolves.not.toThrow();

    run.stop();
    await expect(run.pause(1)).rejects.toBeInstanceOf(Stopped);

    // A stop asked mid-sleep still lands on resume — the real sequence.
    run = startRun('peer:aaa');
    const parked = run.pause(30);
    run.stop();
    await expect(parked).rejects.toBeInstanceOf(Stopped);
  });

  // Both pending at once: the chat check runs first, so the mixed-chat result
  // is discarded rather than being offered as a partial.
  it('a chat switch still outranks a stop', async () => {
    const run = startRun('peer:aaa');
    run.stop();
    openChat = 'peer:zzz';
    await expect(run.pause(1)).rejects.toBeInstanceOf(Cancelled);
  });

  it('a scan-shaped loop keeps its partial result', async () => {
    openChat = 'peer:aaa';
    const run = startRun('peer:aaa');
    const found = new Map<string, unknown>();
    let rounds = 0;
    let stopped = false;
    try {
      for (let i = 0; i < 100; i++) {
        found.set(`item${i}`, { kind: 'photo' });
        rounds++;
        if (i === 6) run.stop();
        await run.pause(1);
      }
    } catch (e) {
      if (!(e instanceof Stopped)) throw e;
      stopped = true;
    }
    expect(stopped).toBe(true);
    expect(rounds).toBeLessThan(100);
    expect(found.size).toBe(rounds);
    expect(found.size).toBeGreaterThanOrEqual(7);
  });

  it('a new run starts un-stopped by construction, so a stop cannot leak into the next run', async () => {
    const stoppedRun = startRun('peer:aaa');
    stoppedRun.stop();
    const nextRun = startRun('peer:aaa');
    expect(nextRun.stopping).toBe(false);
    await expect(nextRun.pause(1)).resolves.not.toThrow();
  });

  // Opposite of a stopped scan, deliberately: a partial zip is a file the user
  // must notice is incomplete, so cancel means cancel for a download.
  it('a stopped DOWNLOAD stops promptly and saves nothing past the stop point', async () => {
    openChat = 'peer:aaa';
    const live = startRun('peer:aaa');

    // Item 3 stops mid-fetch, exactly as the bridge's abort watcher does.
    vi.spyOn(bridge, 'fetchViaPage').mockImplementation(async (url: string) => {
      if (url.endsWith('/c')) { live.stop(); throw new Stopped(); }
      return new Blob([new Uint8Array(10)]);
    });

    // scrollIntoView/getBoundingClientRect are reached before the fetch, so a
    // bare {id} stub never gets there and the pass silently tests nothing.
    const bubbleFor = (id: string) => ({
      id,
      getBoundingClientRect: () => ({ top: 0, height: 10 }),
      scrollIntoView: () => {},
    }) as unknown as Element;
    const pending = ['a', 'b', 'c', 'd'].map((id, i) =>
      ({ key: id, bubble: bubbleFor(id), kind: 'file' as const, at: i * 100 }));

    const found = new Map();
    const res = await loadPending(found, pending, ['file'], () => {});

    expect(res.stopped).toBe(true);
    expect(found.has('https://x/stream/d')).toBe(false);
    expect(res.failures).toContain('stopped');

    // The caller's rule, mirrored: a stopped pass never reaches the archive step.
    const archives = (r: { stopped: boolean }) => { if (r.stopped) throw new Stopped(); return true; };
    expect(() => archives(res)).toThrow(Stopped);
    expect(archives({ stopped: false })).toBe(true);
  });

  it('a chat switch mid-download still discards: that archive would mix two chats', async () => {
    openChat = 'peer:aaa';
    const live = startRun('peer:aaa');
    vi.spyOn(bridge, 'fetchViaPage').mockImplementation(async () => {
      openChat = 'peer:bbb';
      live.check();
      return new Blob();
    });

    const pending = [{
      key: 'a',
      bubble: { id: 'a', getBoundingClientRect: () => ({ top: 0, height: 10 }), scrollIntoView: () => {} } as unknown as Element,
      kind: 'file' as const, at: 0,
    }];
    await expect(loadPending(new Map(), pending, ['file'], () => {})).rejects.toBeInstanceOf(Cancelled);
    openChat = 'peer:aaa';
  });
});
