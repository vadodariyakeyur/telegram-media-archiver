// Download pass: pull the bytes for every kind the scan could only queue.
import { findScroller, glideTo } from '../../tw-sdk/dom';
import { refind } from '../../tw-sdk/locate';
import { openForSrc, closeViewer } from '../../tw-sdk/viewer';
import { docStreamUrl } from '../../tw-sdk/classify';
import { run, Stopped, Cancelled } from '../../tw-sdk/run';
import { sleep } from '../../tw-sdk/utils';
import { fetchViaPage } from './bridge';
import type { FoundItem, MediaKind, PendingItem } from '../../tw-sdk/types';

export interface CollectReport {
  phase: 'fetching';
  done: number;
  total: number;
  kind?: MediaKind;
  pct?: number | null;
  searching?: boolean;
}

export interface CollectResult {
  failures: string[];
  stopped: boolean;
}

interface ScrollerEl extends Element {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export async function loadPending(
  found: Map<string, FoundItem>,
  pending: PendingItem[],
  kinds: MediaKind[],
  report: (r: CollectReport) => void,
): Promise<CollectResult> {
  const failures: string[] = [];
  let stopped = false;
  const scroller = findScroller() as ScrollerEl | null;

  // List order (top downward), NOT scan order. The scan walks bottom-to-top, so
  // processing in that order left the list position and the next target
  // drifting apart — after a dozen videos every lookup needed a full search.
  const wanted = pending
    .filter(p => kinds.includes(p.kind))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

  // A deep sweep can take minutes. Allow a handful so genuinely-lost messages
  // are still recovered, but never let the run degrade into hours of scrolling.
  // ponytail: flat budget, not adaptive. Raise if recovery matters more than time.
  let deepBudget = Math.max(5, Math.ceil(wanted.length * 0.05));

  for (let i = 0; i < wanted.length && !stopped; i++) {
    const entry = wanted[i];
    const kind = entry.kind;

    // A document has no viewer to open or close; its bytes come off the row's
    // own href. Everything else goes through the media viewer.
    const isDoc = kind === 'file';
    let bubble: Element | null = null;

    try {
      // Park the list where this message sat during the scan, so it is already
      // rendered by the time we look for it.
      if (scroller && entry.at != null) {
        const want = Math.max(0, entry.at - scroller.clientHeight / 2);
        if (Math.abs(scroller.scrollTop - want) > scroller.clientHeight / 2) {
          await glideTo(scroller, want, 240);
          await run().waitFor(() => entry.bubble?.isConnected, { budget: 500, floor: 140 });
        }
      }

      // Cheap local search first — the deep sweep costs minutes, so it is only
      // worth paying for a message the local pass could not find.
      bubble = await refind(entry, scroller, { deep: false });
      if (!bubble && deepBudget > 0) {
        deepBudget--;
        report({ phase: 'fetching', done: i, total: wanted.length, searching: true });
        bubble = await refind(entry, scroller, { deep: true });
      }
      if (!bubble) {
        failures.push(deepBudget > 0 ? 'message no longer in list' : 'skipped: search budget spent');
        continue;
      }

      const tick = (got: number, tot: number) => report({
        phase: 'fetching', done: i, total: wanted.length, kind,
        pct: tot ? Math.round((got / tot) * 100) : null,
      });
      tick(0, 0);

      // scrollIntoView({behavior:'smooth'}) cannot be awaited reliably, so
      // glide the container ourselves and know when it has landed.
      const box = bubble.getBoundingClientRect();
      const sBox = scroller?.getBoundingClientRect?.();
      if (scroller && sBox) {
        const centre = scroller.scrollTop + (box.top - sBox.top)
                     - (scroller.clientHeight - box.height) / 2;
        await glideTo(scroller, centre, 220);
      } else {
        bubble.scrollIntoView({ block: 'center' });
      }
      await run().pause(180);   // let the click target settle before opening
      // A document's URL is BUILT from the row, not clicked out of it: this
      // client never puts the finished file in the DOM, so waiting for a link
      // waits forever. Everything else opens the viewer to expose its stream.
      const src = isDoc ? docStreamUrl(bubble) : await openForSrc(bubble);
      if (!src) throw new Error(isDoc
        ? 'could not read the document id or size off the row'
        : 'viewer exposed no URL');

      const blob = await fetchViaPage(src, tick);
      // Key on the src so a repeated item is not fetched twice.
      if (!found.has(src)) found.set(src, { blob, kind, name: entry.name || null });
    } catch (e) {
      // A stop ends the pass cleanly rather than unwinding it, so the caller
      // gets a result to decide on — content.ts discards it. Cancelled still
      // propagates: that result would mix two chats.
      if (e instanceof Stopped) { stopped = true; failures.push('stopped'); break; }
      if (e instanceof Cancelled) throw e;
      failures.push((e as Error).message);
    } finally {
      if (bubble && !isDoc) {
        closeViewer();
        // NOT run().pause(): after a stop that throws Stopped, and a throw from
        // a finally REPLACES the break above — unwinding the pass and discarding
        // every item it had already fetched. The cleanup delay must not abort.
        await sleep(500);   // let the viewer finish closing before the next click
      }
    }
  }
  return { failures, stopped };
}
