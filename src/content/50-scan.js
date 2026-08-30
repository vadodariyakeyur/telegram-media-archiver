// Scan pass: scroll the whole chat and inventory what is there.
// Stills are fetched on sight because Telegram revokes their blob URLs once
// the message scrolls out of the rendered window.

function collected(found, pending) {
  return found.size + pending.length;
}

function atTop(scroller) {
  return scroller.scrollTop <= 5;
}

function tally(found, pending) {
  const counts = {};
  for (const it of found.values()) counts[it.kind] = (counts[it.kind] || 0) + 1;
  for (const p of pending) counts[p.kind] = (counts[p.kind] || 0) + 1;
  return counts;
}

// `prior` resumes a stopped scan: its media and scroll position carry forward,
// so continuing costs only the remaining distance.
async function scanChat(report, prior = null) {
  const scroller = TG.findScroller();
  if (!scroller) throw new Error('Could not find the message list. Open a chat first.');

  const found = prior?.found ?? new Map();
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
  await TG.run().waitFor(() => {
    TG.harvest(found, pending);
    return collected(found, pending) > 0;
  }, { budget: 1600, floor: 300 });

  let idleRounds = 0, lastHeight = -1;
  let stopped = false;
  // ponytail: fixed idle threshold, not a completeness proof. Very long chats
  // may need more patience — raise IDLE_LIMIT if media goes missing.
  const IDLE_LIMIT = 4;

  // A stop unwinds the loop but keeps `found`/`pending`: using what was already
  // collected is the point of stopping. A chat switch (Cancelled) still
  // propagates — that result would mix two chats.
  try {
    while (idleRounds < IDLE_LIMIT) {
      // Report before awaiting the bytes: the sweep claims every slot
      // synchronously, so counts are final for this round already.
      const grabs = TG.harvest(found, pending);
      report({
        phase: 'scanning',
        count: found.size + pending.length,
        counts: tally(found, pending),
      });

      const before = scroller.scrollTop;

      await TG.glideTo(scroller, before - scroller.clientHeight * 0.8);

      // Harvest inside the predicate: it is idempotent (slots claimed by src,
      // pending entries re-pointed) and it is the only thing that makes newly
      // painted media observable. Waiting on a raw node count never fired —
      // Telegram recycles nodes, so the total holds steady while the content
      // turns over completely.
      const beforeCount = collected(found, pending);
      await TG.run().waitFor(() => {
        grabs.push(...TG.harvest(found, pending));
        return collected(found, pending) !== beforeCount || atTop(scroller);
      });

      // Settle every fetch started this round — the sweep's and the wait's
      // alike — BEFORE the next scroll, which revokes their blob URLs.
      await Promise.all(grabs);

      if (collected(found, pending) !== beforeCount) {
        report({
          phase: 'scanning',
          count: collected(found, pending),
          counts: tally(found, pending),
        });
      }

      const moved = Math.abs(scroller.scrollTop - before) > 5;
      const grew = scroller.scrollHeight !== lastHeight;
      lastHeight = scroller.scrollHeight;

      if (!moved && !grew && scroller.scrollTop <= 5) idleRounds++;
      else idleRounds = 0;
    }
    await Promise.all(TG.harvest(found, pending));
  } catch (e) {
    if (!(e instanceof TG.Stopped)) throw e;
    stopped = true;
    // One last sweep so the visible rows are not lost.
    try { await Promise.all(TG.harvest(found, pending)); } catch { /* already stopping */ }
  }

  const at = scroller.scrollTop;
  // The top of the list means the chat was fully walked; there is nothing left
  // to continue into, even if the pass ended via a stop.
  const exhausted = !stopped || at <= 5;

  const counts = tally(found, pending);

  return { found, pending, counts, stopped, at, exhausted };
}

// --- exports ---
TG.scanChat = scanChat;
