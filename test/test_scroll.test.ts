// The scan loop reads scrollTop right after moving, to decide whether it
// moved, whether the list grew, and whether it reached the top. An animated
// scroll that resolves mid-flight would make those reads lie and stop the
// scan early — silently losing media. glideTo must land before it resolves.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let abortReason: (() => Error | null) | null = null;
vi.mock('../tw-sdk/run', () => ({ currentRun: () => (abortReason ? { abortReason } : null) }));

const { glideTo } = await import('../tw-sdk/dom');

type FakeScroller = Element & { scrollTop: number; scrollHeight: number; clientHeight: number };
const mkScroller = (height = 10000, client = 500): FakeScroller =>
  ({ scrollTop: 0, scrollHeight: height, clientHeight: client }) as unknown as FakeScroller;

beforeEach(() => { abortReason = null; });

describe('glideTo', () => {
  it('scrollTop is exactly the target the moment glideTo resolves', async () => {
    const s = mkScroller();
    s.scrollTop = 5000;
    await glideTo(s, 2000, 80);
    expect(s.scrollTop).toBe(2000);
  });

  it("the move is observable to the scan loop's `moved` check", async () => {
    const s = mkScroller();
    s.scrollTop = 2000;
    const before = s.scrollTop;
    await glideTo(s, before - 400, 80);
    expect(Math.abs(s.scrollTop - before)).toBeGreaterThan(5);
  });

  it('clamps at the top, never negative', async () => {
    const c = mkScroller(3000);
    await glideTo(c, -500, 40);
    expect(c.scrollTop).toBe(0);
  });

  it('clamps at scrollHeight', async () => {
    const c = mkScroller(3000);
    await glideTo(c, 999999, 40);
    expect(c.scrollTop).toBe(3000);
  });

  // Landing exactly on 0 matters: the loop's top check is `<= 5`.
  it('reaching the top is detectable', async () => {
    const t = mkScroller();
    t.scrollTop = 300;
    await glideTo(t, 0, 60);
    expect(t.scrollTop).toBeLessThanOrEqual(5);
  });

  it('a zero-distance move is a no-op', async () => {
    const n = mkScroller();
    n.scrollTop = 1234;
    await glideTo(n, 1234, 100);
    expect(n.scrollTop).toBe(1234);
  });

  it('reduced motion still lands exactly', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const r = mkScroller();
    r.scrollTop = 4000;
    await glideTo(r, 100, 500);
    expect(r.scrollTop).toBe(100);
    vi.restoreAllMocks();
  });

  it('the move is animated (not a single jump) and never overshoots the target', async () => {
    const m = mkScroller();
    m.scrollTop = 0;
    const seen: number[] = [];
    const spy = new Proxy(m, {
      set(o, k, v) { if (k === 'scrollTop') seen.push(v as number); (o as unknown as Record<PropertyKey, unknown>)[k] = v; return true; },
    });
    await glideTo(spy, 1000, 120);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every(v => v >= 0 && v <= 1000)).toBe(true);
    expect(seen[seen.length - 1]).toBe(1000);
  });

  // The sweep steps half a screen at a time so every row is rendered at two
  // consecutive stops; a full-screen step would give each row one chance to be
  // caught mid-load, which is how half a chat went missing.
  it('half-screen steps reach the top and overlap on every row', async () => {
    const loop = mkScroller(4000);
    loop.scrollTop = 4000;
    const stops: number[] = [];
    for (let i = 0; i < 100 && loop.scrollTop > 5; i++) {
      stops.push(loop.scrollTop);
      await glideTo(loop, loop.scrollTop - loop.clientHeight * 0.5, 20);
    }
    expect(loop.scrollTop).toBeLessThanOrEqual(5);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i - 1] - stops[i]).toBeLessThan(loop.clientHeight);
    }
  }, 20000);

  it('a requested stop aborts the glide instead of finishing it', async () => {
    class Stopped extends Error {}
    abortReason = () => new Stopped();
    const a = mkScroller();
    a.scrollTop = 5000;
    await expect(glideTo(a, 0, 200)).rejects.toBeInstanceOf(Stopped);
  });

  it('a chat switch aborts the glide the same way', async () => {
    class Cancelled extends Error {}
    abortReason = () => new Cancelled();
    const b = mkScroller();
    b.scrollTop = 5000;
    await expect(glideTo(b, 0, 200)).rejects.toBeInstanceOf(Cancelled);
  });
});
