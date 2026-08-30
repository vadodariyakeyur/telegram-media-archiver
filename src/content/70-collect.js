// Download pass: open each selected video and pull its bytes.

async function loadPending(found, pending, kinds, report) {
  const failures = [];
  const scroller = TG.findScroller();

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

  for (let i = 0; i < wanted.length; i++) {
    const entry = wanted[i];
    const kind = entry.kind;
    // Park the list where this message sat during the scan, so it is already
    // rendered by the time we look for it.
    if (scroller && entry.at != null) {
      const want = Math.max(0, entry.at - scroller.clientHeight / 2);
      if (Math.abs(scroller.scrollTop - want) > scroller.clientHeight / 2) {
        await TG.glideTo(scroller, want, 240);
        await TG.run().waitFor(() => entry.bubble?.isConnected, { budget: 500, floor: 140 });
      }
    }

    // Cheap local search first — the deep sweep costs minutes, so it is only
    // worth paying for a message the local pass could not find.
    let bubble = await TG.refind(entry, scroller, { deep: false });
    if (!bubble && deepBudget > 0) {
      deepBudget--;
      report({ phase: 'videos', done: i, total: wanted.length, searching: true });
      bubble = await TG.refind(entry, scroller, { deep: true });
    }
    if (!bubble) {
      failures.push(deepBudget > 0 ? 'message no longer in list' : 'skipped: search budget spent');
      continue;
    }

    const tick = (got, tot) => report({
      phase: 'videos', done: i, total: wanted.length,
      pct: tot ? Math.round((got / tot) * 100) : null,
    });
    tick(0, 0);

    try {
      // scrollIntoView({behavior:'smooth'}) cannot be awaited reliably, so
      // glide the container ourselves and know when it has landed.
      const box = bubble.getBoundingClientRect();
      const sBox = scroller?.getBoundingClientRect?.();
      if (scroller && sBox) {
        const centre = scroller.scrollTop + (box.top - sBox.top)
                     - (scroller.clientHeight - box.height) / 2;
        await TG.glideTo(scroller, centre, 220);
      } else {
        bubble.scrollIntoView({ block: 'center' });
      }
      await TG.run().pause(180);   // let the click target settle before opening
      const src = await TG.openForSrc(bubble);
      if (!src) throw new Error('viewer exposed no URL');

      const blob = await TG.fetchViaPage(src, tick);
      // Key on the src so a repeated video is not fetched twice.
      if (!found.has(src)) found.set(src, { blob, kind });
    } catch (e) {
      failures.push(e.message);
    } finally {
      TG.closeViewer();
      await TG.run().pause(500);   // let the viewer finish closing before the next click
    }
  }
  return failures;
}

// --- exports ---
TG.loadPending = loadPending;
