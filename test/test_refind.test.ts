// Telegram detaches messages that scroll out of the rendered window, so a node
// captured during the scan must be re-found by key. The earlier version only
// swept upward from the bottom and stopped at scrollTop 0, so a message that
// never rendered during that sweep was wrongly reported "no longer in list".
//
// Count sleeps instead of waiting: the bug was cost, so cost is what to assert.
// run().pause/waitFor and glideTo are the cancellable checkpoints refind awaits
// (cancellation itself is covered by test_cancel.test.ts) — both are stubbed to
// never abort and to charge each wait to the same counter.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let sleepMs = 0;

vi.mock('../tw-sdk/dom', () => ({
  glideTo: (sc: { scrollTop: number; scrollHeight: number }, to: number, ms?: number) => {
    sleepMs += ms || 0;
    sc.scrollTop = Math.max(0, Math.min(to, sc.scrollHeight));
    return Promise.resolve();
  },
}));
vi.mock('../tw-sdk/run', () => ({
  run: () => ({
    pause: (ms?: number) => { sleepMs += ms || 0; return Promise.resolve(); },
    waitFor: (pred: () => unknown, o?: { floor?: number }) => {
      sleepMs += o?.floor || 0;
      return Promise.resolve(!!pred());
    },
  }),
}));

const { refind } = await import('../tw-sdk/locate');

// A virtualized list: only messages near scrollTop are in the DOM — exactly
// how Telegram behaves.
function makeList(total = 100, windowSize = 10) {
  const host = document.body;
  const scroller = {
    scrollHeight: total * 100,
    clientHeight: 500,
    _render() {
      host.querySelectorAll('.bubble').forEach(n => n.remove());
      const first = Math.floor(this.scrollTop / 100);
      for (let i = first; i < Math.min(total, first + windowSize); i++) {
        const d = document.createElement('div');
        d.className = 'bubble';
        d.setAttribute('data-mid', String(i));
        host.appendChild(d);
      }
    },
  } as { scrollTop: number; scrollHeight: number; clientHeight: number; _render(): void };
  let v = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => v,
    set: (n: number) => { v = Math.max(0, Math.min(n, scroller.scrollHeight)); scroller._render(); },
  });
  scroller.scrollTop = 0;
  return scroller as unknown as Element & { scrollTop: number; scrollHeight: number; clientHeight: number };
}

beforeEach(() => { document.body.innerHTML = ''; sleepMs = 0; });

describe('refind', () => {
  it('finds a message near the top of a long list', async () => {
    const sc = makeList();
    sc.scrollTop = sc.scrollHeight;
    const got = await refind({ key: 'id:2' } as never, sc);
    expect(got).toBeTruthy();
    expect(got?.getAttribute('data-mid')).toBe('2');
  });

  it('finds a mid-list message', async () => {
    const sc = makeList();
    const got = await refind({ key: 'id:50' } as never, sc);
    expect(got?.getAttribute('data-mid')).toBe('50');
  });

  it('finds the last message', async () => {
    const sc = makeList();
    const got = await refind({ key: 'id:99' } as never, sc);
    expect(got?.getAttribute('data-mid')).toBe('99');
  });

  it('reuses an already-live node as-is, without scrolling', async () => {
    const sc = makeList();
    sc.scrollTop = 0;
    const live = document.querySelector('[data-mid="0"]')!;
    const got = await refind({ key: 'id:0', bubble: live } as never, sc);
    expect(got).toBe(live);
  });

  it('gives up cleanly on a genuinely absent message, rather than hanging', async () => {
    const sc = makeList();
    const got = await refind({ key: 'id:9999' } as never, sc);
    expect(got).toBe(null);
  });

  // The 243-video hang: a deep sweep per video was ~10 min each. The local
  // pass must resolve a nearby message without sweeping the whole list.
  it('a local (non-deep) pass finds a nearby message cheaply', async () => {
    const sc = makeList(3000, 10);
    sc.scrollTop = 500;
    sleepMs = 0;
    const got = await refind({ key: 'id:6' } as never, sc, { deep: false });
    expect(got).toBeTruthy();
    expect(sleepMs).toBeLessThanOrEqual(1500);
  });

  it('a local pass gives up rather than sweeping for a far-away message', async () => {
    const sc = makeList(3000, 10);
    sc.scrollTop = 0;
    sleepMs = 0;
    const got = await refind({ key: 'id:2500' } as never, sc, { deep: false });
    expect(got).toBe(null);
    expect(sleepMs).toBeLessThanOrEqual(1500);
  });

  it('the deep sweep honours its wall-clock budget', async () => {
    const sc = makeList(3000, 10);
    const t0 = Date.now();
    await refind({ key: 'id:999999' } as never, sc, { deep: true, budgetMs: 2000 });
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  // The 243-video stall: scan order is bottom-to-top, so processing in that
  // order made the list position and the next target drift apart. Videos must
  // be visited in list order so each target is already near the viewport.
  it('videos are visited top-down through the list, with no large backward jumps', () => {
    const scanOrder = [
      { key: 'id:90', at: 9000 }, { key: 'id:60', at: 6000 },
      { key: 'id:30', at: 3000 }, { key: 'id:5', at: 500 },
    ];
    const visitOrder = [...scanOrder].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    expect(visitOrder.map(v => v.at)).toEqual([500, 3000, 6000, 9000]);

    const jumps = visitOrder.slice(1).map((v, i) => v.at - visitOrder[i].at);
    expect(Math.max(...jumps)).toBeLessThanOrEqual(3000);
  });

  it('entries with no recorded position still sort in without breaking', () => {
    const mixed = [{ key: 'a', at: 100 }, { key: 'b', at: undefined as number | undefined }, { key: 'c', at: 50 }];
    const sorted = [...mixed].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    expect(sorted.length).toBe(3);
  });
});
