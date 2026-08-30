// Re-finding a message whose DOM node was recycled.
// Telegram virtualizes the list, so a node captured during the scan is usually
// detached by download time.

async function refind(entry, scroller, opts = { deep: true }) {
  if (entry.bubble?.isConnected && TG.bubbleKey(entry.bubble) === entry.key) return entry.bubble;

  const byId = entry.key.startsWith('id:') && entry.key.slice(3);
  const hit = () => {
    if (byId) {
      const q = `[data-mid="${CSS.escape(byId)}"], [data-message-id="${CSS.escape(byId)}"], #${CSS.escape(byId)}`;
      const el = document.querySelector(q);
      if (el) return el;
    }
    for (const b of document.querySelectorAll('.message, .Message, .bubble, [data-mid], [data-message-id]')) {
      if (TG.bubbleKey(b) === entry.key) return b;
    }
    return null;
  };

  let el = hit();
  if (el) return (entry.bubble = el);

  // A recycled node is almost always a screen or two away, so this resolves the
  // common case in about a second instead of sweeping the entire list.
  if (scroller) {
    const near = Math.max(200, scroller.clientHeight * 0.9);
    const from = scroller.scrollTop;
    for (const d of [near, -near, near * 2, -near * 2]) {
      await TG.glideTo(scroller, from + d, 200);
      el = hit();
      if (!el) { await TG.run().waitFor(() => !!hit(), { budget: 350, floor: 100 }); el = hit(); }
      if (el) return (entry.bubble = el);
    }
    await TG.glideTo(scroller, from, 180);
  }

  // Full two-way sweep. EXPENSIVE — minutes on a long chat — so it must stay a
  // genuine last resort, never a per-item step.
  if (opts.deep && scroller) {
    // Scale the stride to the list: creeping 0.7 screens at a time across a
    // 300000px list is what made this take minutes.
    const step = Math.max(scroller.clientHeight * 0.7,
                          scroller.scrollHeight / 120);

    for (const dir of ['up', 'down']) {
      // Deliberately not animated: this sweep is time-boxed, so every frame
      // spent gliding is a frame not spent searching.
      scroller.scrollTop = dir === 'up' ? scroller.scrollHeight : 0;
      await TG.run().pause(400);

      let stuck = 0;
      const cap = Math.ceil(scroller.scrollHeight / step) + 10;
      // Bound the wall clock too: on a very long chat the step cap alone is
      // minutes per lookup, which reads as a hang.
      const until = Date.now() + (opts.budgetMs ?? 20000) / 2;   // per direction

      for (let i = 0; i < cap && stuck < 3 && Date.now() < until; i++) {
        el = hit();
        if (el) return (entry.bubble = el);

        const before = scroller.scrollTop;
        scroller.scrollTop = dir === 'up'
          ? Math.max(0, before - step)
          : Math.min(scroller.scrollHeight, before + step);
        await TG.run().waitFor(() => !!hit(), { budget: 350, floor: 120 });

        // Telegram loads older messages lazily, so a stalled scroll may just
        // mean it is still fetching; only give up after several no-ops.
        stuck = Math.abs(scroller.scrollTop - before) < 5 ? stuck + 1 : 0;
      }

      el = hit();
      if (el) return (entry.bubble = el);
    }
  }
  return null;
}

// --- exports ---
TG.refind = refind;
