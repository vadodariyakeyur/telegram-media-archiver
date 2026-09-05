// Scan pass: scroll the whole chat and inventory what is there.
// Stills are fetched on sight because Telegram revokes their blob URLs once
// the message scrolls out of the rendered window.
//
// Completeness beats speed here. Telegram paints a screenful progressively
// and unmounts rows once they leave the window, so anything the scan does not
// see while it is rendered is lost for good — there is no second chance
// short of scrolling back over it. Every choice below trades time for another
// look at the same pixels.
import { findScroller, glideTo } from './dom';
import { harvest } from './classify';
import { run, Stopped } from './run';
import type { FoundItem, PendingItem, ScanResult } from './types';

interface ScrollerEl extends Element {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

function collected(found: Map<string, FoundItem>, pending: PendingItem[]): number {
  return found.size + pending.length;
}

function tally(found: Map<string, FoundItem>, pending: PendingItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const it of found.values()) counts[it.kind] = (counts[it.kind] || 0) + 1;
  for (const p of pending) counts[p.kind] = (counts[p.kind] || 0) + 1;
  return counts;
}

export interface ScanReport {
  phase: 'scanning' | 'zipping';
  count?: number;
  counts?: Record<string, number>;
}

// Half a screen per step, so every row is rendered across two consecutive
// stops. A full-screen step relies on catching each row in its single visit;
// one slow-loading thumbnail then vanishes unharvested.
const STEP = 0.5;

// How long a screenful may keep producing new media before the scan accepts
// that it has settled. This is the single most important number for
// completeness: leaving too early is exactly how half a chat goes missing.
const SETTLE_QUIET = 700;    // ms of no new media before a stop counts as done
const SETTLE_MAX = 6000;     // ms ceiling, so one stuck thumbnail cannot hang the pass

// Harvest until the rendered screenful stops yielding anything new. Unlike a
// wait that returns on the FIRST new item, this keeps looking while media is
// still arriving — a screenful loads progressively, and returning early
// abandons whatever had not painted yet.
async function settle(found: Map<string, FoundItem>, pending: PendingItem[], grabs: Promise<unknown>[]): Promise<void> {
  const hardStop = Date.now() + SETTLE_MAX;
  let lastChange = Date.now();
  let count = collected(found, pending);

  while (Date.now() < hardStop && Date.now() - lastChange < SETTLE_QUIET) {
    await run().pause(120);
    grabs.push(...harvest(found, pending));
    const now = collected(found, pending);
    if (now !== count) { count = now; lastChange = Date.now(); }
  }
}

// One traversal of the chat in a single direction, harvesting at every stop.
// Returns the number of items collected when it finished.
async function sweep(
  scroller: ScrollerEl,
  up: boolean,
  found: Map<string, FoundItem>,
  pending: PendingItem[],
  report: (r: ScanReport) => void,
): Promise<void> {
  // Guard against a chat that keeps growing under the scan: bounded by the
  // number of steps the list length could possibly need, not by a stall check.
  const maxStops = Math.ceil(scroller.scrollHeight / Math.max(1, scroller.clientHeight * STEP)) + 20;

  for (let stop = 0; stop < maxStops; stop++) {
    const grabs = harvest(found, pending);
    await settle(found, pending, grabs);

    // Settle every fetch started at this stop BEFORE moving, which revokes
    // the blob URLs they are reading.
    await Promise.all(grabs);

    report({ phase: 'scanning', count: collected(found, pending), counts: tally(found, pending) });

    // Read scrollTop AFTER settling, never before it. A screenful of videos
    // grows as placeholders are replaced by real elements, and everything
    // below the viewport shifts down with it — a target computed against the
    // pre-settle layout lands somewhere else entirely, which both looks like a
    // glitching scroll and skips whatever the shift jumped over.
    const before = scroller.scrollTop;
    const delta = scroller.clientHeight * STEP;
    await glideTo(scroller, up ? before - delta : before + delta);

    // The move itself can trigger another round of layout. If the list shifted
    // under the glide, the landing is not where the step intended, so correct
    // back rather than carrying the error into every later stop.
    const want = Math.max(0, Math.min(up ? before - delta : before + delta,
                                      scroller.scrollHeight - scroller.clientHeight));
    if (Math.abs(scroller.scrollTop - want) > 2) scroller.scrollTop = want;

    // scrollHeight is read AFTER the move: scrolling to the top is what makes
    // Telegram prepend older history, so the list this step revealed is only
    // measurable now.
    const limit = up ? 5 : scroller.scrollHeight - scroller.clientHeight - 5;
    const arrived = up ? scroller.scrollTop <= limit : scroller.scrollTop >= limit;
    if (!arrived) continue;

    // At the end of the list, but Telegram may still be loading more in that
    // direction. Wait, then check whether the reachable range actually grew;
    // only a range that stopped growing means the chat is exhausted.
    const wasHeight = scroller.scrollHeight;
    await run().pause(900);
    const grabsEnd = harvest(found, pending);
    await settle(found, pending, grabsEnd);
    await Promise.all(grabsEnd);
    if (scroller.scrollHeight === wasHeight) return;
  }
}

// `prior` resumes a stopped scan: its media and scroll position carry forward,
// so continuing costs only the remaining distance.
export async function scanChat(report: (r: ScanReport) => void, prior: ScanResult | null = null): Promise<ScanResult> {
  const scroller = findScroller() as ScrollerEl | null;
  if (!scroller) throw new Error('Could not find the message list. Open a chat first.');

  const found = prior?.found ?? new Map<string, FoundItem>();
  const pending = prior?.pending ?? [];   // videos awaiting a click to load

  if (prior?.at != null) {
    // Nudge down slightly so the boundary row is re-harvested rather than
    // falling in the gap between passes.
    scroller.scrollTop = Math.min(scroller.scrollHeight,
                                  prior.at + scroller.clientHeight * 0.3);
  } else {
    scroller.scrollTop = scroller.scrollHeight;
  }
  // First paint of a chat is the slowest, so give it the full budget.
  await run().waitFor(() => {
    harvest(found, pending);
    return collected(found, pending) > 0;
  }, { budget: 1600, floor: 300 });

  let stopped = false;
  let atTop = false;

  // A stop unwinds the loop but keeps `found`/`pending`: using what was already
  // collected is the point of stopping. A chat switch (Cancelled) still
  // propagates — that result would mix two chats.
  try {
    // Two passes, bottom to top and back down. One is not enough: a row still
    // loading when the scan went past it is unmounted before it paints, and
    // the return trip is the only thing that gives it a second chance.
    await sweep(scroller, true, found, pending, report);
    atTop = true;
    await sweep(scroller, false, found, pending, report);

    await Promise.all(harvest(found, pending));
  } catch (e) {
    if (!(e instanceof Stopped)) throw e;
    stopped = true;
    // One last sweep so the visible rows are not lost.
    try { await Promise.all(harvest(found, pending)); } catch { /* already stopping */ }
  }

  const at = scroller.scrollTop;
  // Reaching the top means the chat was fully walked; there is nothing left to
  // continue into, even if the pass ended via a stop.
  const exhausted = !stopped || atTop || at <= 5;

  const counts = tally(found, pending);

  return { found, pending, counts, stopped, at, exhausted };
}
