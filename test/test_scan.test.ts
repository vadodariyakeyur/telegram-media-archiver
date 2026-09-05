// The scan used to leave a stop on the FIRST newly painted item and scroll
// away, so a screenful that loaded progressively — which is every screenful in
// Telegram — lost whatever had not painted yet. That is what "missing half the
// media" was. These checks pin the settle-then-move behaviour.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const scroller = {
  scrollTop: 0,
  scrollHeight: 2000,
  clientHeight: 500,
};

let harvestCalls = 0;
// Media that appears one item per harvest call, the way a screenful paints.
let queue: string[] = [];
// When set, an item only paints while the scan stays put — leave the stop and
// the rest of that screenful is gone for good, exactly as Telegram unmounts it.
let perishable = false;
let lastPos = -1;

vi.mock('../tw-sdk/dom', () => ({
  findScroller: () => scroller,
  chatKey: () => 'peer:test',   // run.ts reads this for its abort check
  glideTo: async (s: typeof scroller, target: number) => {
    s.scrollTop = Math.max(0, Math.min(target, s.scrollHeight));
  },
}));

vi.mock('../tw-sdk/classify', () => ({
  harvest: (found: Map<string, unknown>) => {
    harvestCalls++;
    // Arriving at a new stop is what unmounts what had not painted yet; the
    // first harvest at that stop still sees the screenful it just reached.
    if (perishable && lastPos !== -1 && scroller.scrollTop !== lastPos) queue = [];
    lastPos = scroller.scrollTop;
    const next = queue.shift();
    if (next) found.set(next, { kind: 'photo' });
    return [];
  },
}));

const { scanChat } = await import('../tw-sdk/scan');

beforeEach(() => {
  scroller.scrollTop = 2000;
  scroller.scrollHeight = 2000;
  harvestCalls = 0;
  queue = [];
  perishable = false;
  lastPos = -1;
});
afterEach(() => vi.restoreAllMocks());

describe('scanChat', () => {
  it('collects media that paints across several harvests at one stop', async () => {
    // Ten items trickling in one per harvest, and unmounted the moment the
    // scan moves on. The old first-hit wait left after the first, so nine of
    // the ten were never seen again — the "missing half the media" bug.
    perishable = true;
    queue = Array.from({ length: 10 }, (_, i) => `blob:${i}`);
    const r = await scanChat(() => {});
    expect(r.found.size).toBe(10);
  }, 60000);

  // The scan ends at the bottom, not the top: the second pass walks back down.
  // `exhausted` records that the top WAS reached, which is what decides whether
  // there is anything left to continue into — the final scrollTop does not.
  it('reaches the top and reports the chat exhausted', async () => {
    queue = ['blob:only'];
    const r = await scanChat(() => {});
    expect(scroller.scrollTop).toBeGreaterThanOrEqual(scroller.scrollHeight - scroller.clientHeight - 5);
    expect(r.exhausted).toBe(true);
  }, 60000);

  it('keeps sweeping while the list grows under it', async () => {
    queue = ['blob:a'];
    let grew = false;
    const r = await scanChat(() => {
      // Telegram prepends older history once the scan reaches the top.
      if (!grew && scroller.scrollTop <= 5) {
        grew = true;
        scroller.scrollHeight = 4000;
        queue.push('blob:older');
      }
    });
    expect(r.found.has('blob:older')).toBe(true);
  }, 60000);
});
