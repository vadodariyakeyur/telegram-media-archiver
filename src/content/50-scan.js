// Scan pass: scroll the whole chat and inventory what is there.
// Stills are fetched on sight because Telegram revokes their blob URLs once
// the message scrolls out of the rendered window.

// `prior` resumes a stopped scan: its collected media and the scroll position
// it reached are carried forward, so continuing costs only the remaining
// distance rather than re-walking the whole chat.
// How much media is currently rendered. The scan's per-step wait exists for
// Telegram to paint newly visible messages, and this is the signal that it
// has: cheaper than a fixed delay on a fast chat, and honest on a slow one.
function mediaInView() {
  return document.querySelectorAll('img, video, audio').length;
}

function atTop(scroller) {
  return scroller.scrollTop <= 5;
}

// Tally what has been collected so far, by media type. Used both for the
// final result and for live progress, so the popup's manifest can update
// while the scan is still running rather than only when a pass ends.
function tally(found, pending) {
  const counts = {};
  for (const it of found.values()) counts[it.kind] = (counts[it.kind] || 0) + 1;
  for (const p of pending) counts[p.kind] = (counts[p.kind] || 0) + 1;
  return counts;
}

async function scanChat(report, prior = null) {
  const scroller = TG.findScroller();
  if (!scroller) throw new Error('Could not find the message list. Open a chat first.');

  const found = prior?.found ?? new Map();
  const pending = prior?.pending ?? [];   // videos awaiting a click to load

  if (prior?.at != null) {
    // Pick up where the stop left off. Nudge down slightly so the boundary
    // row is re-harvested rather than falling in the gap between passes.
    scroller.scrollTop = Math.min(scroller.scrollHeight,
                                  prior.at + scroller.clientHeight * 0.3);
  } else {
    scroller.scrollTop = scroller.scrollHeight;
  }
  // First paint of a chat is the slowest, so give it the full budget.
  await TG.run().waitFor(() => mediaInView() > 0, { budget: 1600, floor: 300 });

  let idleRounds = 0, lastHeight = -1;
  let stopped = false;
  // ponytail: fixed idle threshold, not a completeness proof. Very long chats
  // may need more patience — raise IDLE_LIMIT if media goes missing.
  const IDLE_LIMIT = 4;

  // A stop unwinds the loop but keeps `found` and `pending`: the whole point
  // of stopping a long scan is to use what it has already collected. A chat
  // switch (Cancelled) still propagates — that result would be a mix of two
  // chats, so it must not be offered.
  try {
    while (idleRounds < IDLE_LIMIT) {
      await TG.harvest(found, pending);
      report({
        phase: 'scanning',
        count: found.size + pending.length,
        counts: tally(found, pending),
      });

      const before = scroller.scrollTop;
      const beforeMedia = mediaInView();

      // glideTo resolves only once the move has landed, so the reads below
      // stay truthful — a mid-animation scrollTop would misreport a stall.
      await TG.glideTo(scroller, before - scroller.clientHeight * 0.8);

      // Wait for Telegram to actually render the newly visible media rather
      // than paying a fixed worst-case delay every step.
      await TG.run().waitFor(() => mediaInView() !== beforeMedia || atTop(scroller));

      const moved = Math.abs(scroller.scrollTop - before) > 5;
      const grew = scroller.scrollHeight !== lastHeight;
      lastHeight = scroller.scrollHeight;

      if (!moved && !grew && scroller.scrollTop <= 5) idleRounds++;
      else idleRounds = 0;
    }
    await TG.harvest(found, pending);
  } catch (e) {
    if (!(e instanceof TG.Stopped)) throw e;
    stopped = true;
    // One last sweep of what is on screen, so the visible rows are not lost.
    try { await TG.harvest(found, pending); } catch { /* already stopping */ }
  }

  // Where this pass ended: a continue resumes from here.
  const at = scroller.scrollTop;
  // The top of the list means the chat was fully walked; there is nothing
  // left to continue into, even if the pass ended via a stop.
  const exhausted = !stopped || at <= 5;

  const counts = tally(found, pending);

  return { found, pending, counts, stopped, at, exhausted };
}

// Load the selected video/gif bubbles by clicking them open, then merge the
// resulting blobs into `found`.
// Open each selected video/gif, pull the real file over Range, and stash the
// resulting Blob. Videos are fetched here rather than in zipAndSave because
// the bytes only become reachable while the viewer is open.
// Telegram only keeps a window of messages in the DOM, so a node captured
// during the scan is often detached by download time. Re-find it by key,
// scrolling the list until it is rendered again.

// --- exports ---
TG.tally = tally;
TG.scanChat = scanChat;
