// Entry point: owns run state and the popup message contract.
//
// Loaded last (see manifest.json), so every TG.* module it calls is already
// defined. Nothing else in src/content/ talks to chrome.runtime — keeping the
// messaging surface in one file makes the popup contract easy to audit.

let running = false;
// The popup unmounts whenever it loses focus (including when the save dialog
// opens), taking its message listener with it. Keep the latest state here so a
// reopened popup can ask for it instead of showing a blank panel.
let state = { type: 'IDLE' };

// What has been scanned and what may follow — see 90-session.js. This file
// owns transport only: decode a message, ask the session, reply.
const session = new TG.Session();

// Drop the scan when the open chat changes, and tell the popup to reset.
function invalidateIfChatChanged() {
  if (!session.invalidateIfChatChanged(TG.chatKey())) return false;
  state = { type: 'RESET' };
  return true;
}

// Reloading the extension leaves this script running in a tab it can no
// longer talk to: Chrome keeps the `chrome` object but strips `runtime` off
// it. Every use has to tolerate that, including the load-time registration
// below — a bare `chrome.runtime.onMessage` throws before any listener exists.
const alive = () => {
  try { return !!chrome.runtime?.id; } catch { return false; }
};

// Sending to a closed popup rejects; that is expected, so swallow it.
//
// A dead context is different: sendMessage THROWS SYNCHRONOUSLY rather than
// returning a rejected promise, so .catch() alone never sees it. Unguarded,
// that throw unwinds whatever run is in flight, once per progress tick.
function send(m) {
  if (!alive()) return;
  try { chrome.runtime.sendMessage(m)?.catch(() => {}); } catch { /* context gone */ }
}

const push = m => { state = m; send(m); };

// Every run goes through here, so the cancellation lifecycle lives here too:
// stamp the chat on the way in, clear it on the way out.
function begin(job) {
  if (running) return false;
  running = true;
  // One call replaces "stamp the chat, then clear the stop flag". A run
  // starts with fresh state by construction, so a stop can never leak into
  // the next run — that used to be a comment, and before that a bug.
  const run = TG.startRun(TG.chatKey());

  job()
    .catch(e => {
      // A cancelled run is not a failure to report — the chat simply changed
      // underneath it. Drop the partial result and reset the popup instead.
      if (e instanceof TG.Stopped) {
        // The user asked to stop. Whatever completed already stands.
        push({ type: 'STOPPED' });
      } else if (e instanceof TG.Cancelled) {
        session.clear();
        push({ type: 'RESET', reason: 'chat-changed' });
      } else {
        push({ type: 'ERROR', message: e.message });
      }
    })
    .finally(() => { running = false; TG.endRun(run); });
  return true;
}


// Shape a counts map into the labelled rows the popup renders. SCANNED and
// live progress both use this, so the popup never needs its own copy of the
// type names.
// Turn a scan progress report into a PROGRESS message with labelled rows.
function scanProgress(p) {
  const m = { type: 'PROGRESS', ...p };
  if (p.counts) m.types = typeRows(p.counts);
  delete m.counts;
  return m;
}

function typeRows(counts) {
  return Object.entries(counts || {})
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => ({ kind, label: TG.TYPES[kind] || kind, count: n }));
}

// Report a finished scan pass. `partial` marks the counts as a floor, and
// `resumable` tells the popup a continue is still possible.
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

// A stale script in an orphaned tab has nothing to listen for: the popup it
// would answer belongs to an extension context that no longer exists. Skip
// the registration rather than throwing at load.
if (alive()) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_STATE') {
    // A popup opening after a chat switch must not be handed stale results.
    if (!running) invalidateIfChatChanged();
    sendResponse(state);
    return;
  }

  if (msg.type === 'GET_THEME') {
    // Read on demand rather than caching: the user can switch Telegram's
    // theme while the popup is closed, and this is cheap.
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
      // Hand the previous pass's media and position back so the scan picks up
      // where it stopped rather than re-walking the chat.
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
      // Report every type present, labelled, so the popup can list them.
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
      // Video bytes are only reachable while the viewer is open, so fetch
      // those first; the reasons any of them failed are worth showing.
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

// The popup may be open while the user switches chats, in which case nothing
// would ask for state. Watch the hash so the reset reaches it immediately.
// A run in progress is left alone: it is still working on its own chat, and
// its own completion message will land normally.
addEventListener('hashchange', () => {
  // A run in progress cancels itself: its next checkpoint sees the chat no
  // longer matches and unwinds, which pushes RESET from begin()'s handler.
  // Nothing to do here but handle the idle case.
  if (running) return;
  if (invalidateIfChatChanged()) send(state);
});
