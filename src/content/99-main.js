// Entry point: owns run state and the panel message contract.
// Loaded last (see manifest.json), so every TG.* module it calls is defined.
// Nothing else in src/content/ talks to chrome.runtime.

let running = false;
// The panel can be closed, taking its message listener with it. Keep the latest
// state here so a reopened panel can ask for it instead of showing blank.
let state = { type: 'IDLE' };

const session = new TG.Session();

function invalidateIfChatChanged() {
  if (!session.invalidateIfChatChanged(TG.chatKey())) return false;
  state = { type: 'RESET' };
  return true;
}

// Reloading the extension leaves this script running in a tab it can no longer
// talk to: Chrome keeps `chrome` but strips `runtime` off it. Every use has to
// tolerate that, including the load-time registration below — a bare
// `chrome.runtime.onMessage` throws before any listener exists.
const alive = () => {
  try { return !!chrome.runtime?.id; } catch { return false; }
};

// Sending to a closed panel rejects; that is expected, so swallow it.
//
// A dead context is different: sendMessage THROWS SYNCHRONOUSLY rather than
// returning a rejected promise, so .catch() alone never sees it. Unguarded,
// that throw unwinds whatever run is in flight, once per progress tick.
function send(m) {
  if (!alive()) return;
  try { chrome.runtime.sendMessage(m)?.catch(() => {}); } catch { /* context gone */ }
}

const push = m => { state = m; send(m); };

function begin(job) {
  if (running) return false;
  running = true;
  // Constructing the run replaces "stamp the chat, then clear the stop flag":
  // a run starts with fresh state, so a stop can never leak into the next one.
  const run = TG.startRun(TG.chatKey());

  job()
    .catch(e => {
      if (e instanceof TG.Stopped) {
        push({ type: 'STOPPED' });
      } else if (e instanceof TG.Cancelled) {
        // Not a failure to report — the chat changed underneath it. Drop the
        // partial result and reset the panel.
        session.clear();
        push({ type: 'RESET', reason: 'chat-changed' });
      } else {
        push({ type: 'ERROR', message: e.message });
      }
    })
    .finally(() => { running = false; TG.endRun(run); });
  return true;
}

function scanProgress(p) {
  const m = { type: 'PROGRESS', ...p };
  if (p.counts) m.types = typeRows(p.counts);
  delete m.counts;
  return m;
}

// The content script owns the type names, so the panel keeps no second copy.
function typeRows(counts) {
  return Object.entries(counts || {})
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => ({ kind, label: TG.TYPES[kind] || kind, count: n }));
}

function announceScan() {
  const types = typeRows(session.scan.counts);
  if (!types.length) {
    throw new Error(session.isPartial
      ? 'Stopped before any media was found.'
      : 'No media found in this chat.');
  }
  push({
    type: 'SCANNED',
    types,
    partial: session.isPartial,
    resumable: session.canContinue,
  });
}

// Deliberately send() and NOT push(): the theme is not run state, and storing
// it would hand a palette back to the next GET_STATE in place of run status.
if (alive()) {
  try { TG.watchTheme(theme => send({ type: 'THEME', theme })); } catch {}
}

// A stale script in an orphaned tab has nothing to listen for, so skip the
// registration rather than throwing at load.
if (alive()) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_STATE') {
    // A panel opening after a chat switch must not be handed stale results.
    if (!running) invalidateIfChatChanged();
    sendResponse(state);
    return;
  }

  if (msg.type === 'GET_THEME') {
    let theme = null;
    try { theme = TG.readTheme(); } catch { theme = null; }
    sendResponse({ theme });
    return;
  }

  if (msg.type === 'STOP') {
    if (!running) { sendResponse({ error: 'Nothing running.' }); return; }
    TG.currentRun()?.stop();
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'CONTINUE') {
    if (invalidateIfChatChanged()) {
      sendResponse({ error: 'Chat changed. Scan again.' });
      return;
    }
    const refusal = session.refuseContinue();
    if (refusal) { sendResponse({ error: refusal }); return; }

    const ok = begin(async () => {
      const chatKey = TG.chatKey();
      const result = await TG.scanChat(p => push(scanProgress(p)), session.scan);
      session.record(result, chatKey);
      announceScan();
    });
    sendResponse(ok ? { ok: true } : { error: 'Already running.' });
    return;
  }

  if (msg.type === 'SCAN') {
    const ok = begin(async () => {
      const chatKey = TG.chatKey();
      const result = await TG.scanChat(p => push(scanProgress(p)));
      session.record(result, chatKey);
      announceScan();
    });
    sendResponse(ok ? { ok: true } : { error: 'Already running.' });
    return;
  }

  if (msg.type === 'DOWNLOAD') {
    const kinds = msg.kinds || [];
    if (invalidateIfChatChanged()) {
      sendResponse({ error: 'Chat changed. Scan again.' });
      return;
    }
    const refusal = session.refuseDownload(kinds);
    if (refusal) { sendResponse({ error: refusal }); return; }

    const ok = begin(async () => {
      // Video bytes are only reachable while the viewer is open, so fetch those
      // first; the reasons any of them failed are worth showing.
      const vidFails = await TG.loadPending(
        session.scan.found, session.scan.pending, kinds,
        p => push({ type: 'PROGRESS', ...p }));
      const items = session.itemsFor(kinds);
      // Report why the videos failed rather than a generic empty-set message —
      // the reason is the only thing that makes this debuggable.
      if (!items.length) {
        throw new Error(vidFails.length
          ? `All ${vidFails.length} failed: ${[...new Set(vidFails)].join('; ')}`
          : 'Nothing to download for the selected types.');
      }
      const res = await TG.zipAndSave(items, p => push({ type: 'PROGRESS', ...p }));
      push({ type: 'DONE', ...res, videoFailed: vidFails.length, reasons: [...new Set(vidFails)].slice(0, 3) });
    });
    sendResponse(ok ? { ok: true } : { error: 'Already running.' });
    return;
  }
});

// The panel may be open while the user switches chats, in which case nothing
// would ask for state.
addEventListener('hashchange', () => {
  // A run in progress cancels itself: its next checkpoint sees the chat no
  // longer matches and unwinds, which pushes RESET from begin()'s handler.
  if (running) return;
  if (invalidateIfChatChanged()) send(state);
});
