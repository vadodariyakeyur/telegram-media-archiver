// Translating content-script messages into log lines and run state.
// The only module that knows the message contract's shape.
import { els } from './dom.js';
import { log, setState, resetLog } from './log.js';
import { renderTypes, syncGo, setGoCancels, goCancels, markPartial, updateCounts } from './manifest.js';
import { applyTheme } from './theme.js';
import { setPage, setPhase } from './hint.js';

// Set when the user asks to stop, cleared when any run begins or ends. Lets a
// DONE explain a stop that landed too late instead of dropping it silently.
let stopAsked = false;
export function markStopAsked(yes = true) { stopAsked = yes; }

// Every state change routes through here so the two buttons can never both be
// visible, or both hidden.
//
// Only a SCAN swaps this slot for Stop: "keep what was found" is the scan's
// promise, and it is the run's only abort. A download cancels from its own
// button instead (see setGoCancels), so here Scan just greys out — swapping in
// a second abort would give one run two of them.
function setBusy(busy, fetching) {
  const scanning = busy && !fetching;
  els.scan.hidden = scanning;
  els.stop.hidden = !scanning;
  els.stop.disabled = false;
  els.stop.textContent = 'Stop and keep what was found';
  els.scan.disabled = busy;
  if (busy) els.more.hidden = true;
}

// Kept separate from setBusy so a finished or exhausted scan never shows a
// button that would immediately report "already at the top".
function showResumable(yes) {
  els.more.hidden = !yes;
  els.more.disabled = false;
  els.more.textContent = 'Continue scanning';
}

export function render(msg) {
  if (!msg) return;

  if (msg.type === 'RESET') {
    stopAsked = false;
    renderTypes(null);
    resetLog();
    setState('Idle');
    setPhase('idle');
    setGoCancels(false);
    setBusy(false);
    showResumable(false);
    if (msg.reason === 'chat-changed') log('Chat changed — run stopped', 'err');
    return;
  }

  // A theme switch touches only the palette. It MUST return before the run
  // state below, which would otherwise read a theme push as "not running" and
  // swap a live scan's Stop button back to Scan.
  if (msg.type === 'THEME') { applyTheme(msg.theme); return; }

  // Same reason as THEME: page state is not run state, and falling through
  // would read it as "not running" and end a live run's UI mid-scan.
  if (msg.type === 'PAGE') { setPage(msg); return; }

  const busy = msg.type === 'PROGRESS';
  // 'scanning' is the only phase that is not a download; fetching, downloading
  // and zipping are all stages of one.
  const fetching = busy && msg.phase !== 'scanning';
  setBusy(busy, fetching);
  // A download's own button becomes its cancel: it is the control the user just
  // pressed and is already watching, and a run with no visible way to abort
  // reads as a hang. Zipping is deliberately included — a gigabyte archive
  // takes long enough to need an exit.
  setGoCancels(fetching);
  if (busy && !fetching) els.go.disabled = true; else syncGo();

  if (msg.type === 'PROGRESS') {
    if (msg.phase === 'scanning') {
      setState('Scanning', 'busy');
      setPhase('scanning');
      log(`Scanning chat — ${msg.count} items`, 'live', { transient: true });
      // Keep the manifest live while the scan runs: a list that only appears at
      // the end made a continued scan look like it had stalled.
      if (msg.types) {
        updateCounts(msg.types);
        markPartial(true);   // still climbing; these are a floor
      }

    } else if (msg.phase === 'videos') {
      setState('Downloading', 'busy');
      setPhase('fetching');
      // A deep search scrolls the whole list; say so, or it reads as a hang.
      log(msg.searching
        ? `Video ${msg.done + 1}/${msg.total} — searching chat`
        : `Video ${msg.done + 1}/${msg.total}${msg.pct != null ? ` — ${msg.pct}%` : ''}`,
        'live', { transient: true });

    } else if (msg.phase === 'downloading') {
      setState('Collecting', 'busy');
      setPhase('fetching');
      log(`Collecting ${msg.done + 1}/${msg.total}`, 'live', { transient: true });

    } else if (msg.phase === 'zipping') {
      setState('Packing', 'busy');
      setPhase('zipping');
      log('Building archive', 'live');
      // Past the point of no return: the archive step has no abort checkpoints
      // (deliberately — a half-written zip is worse than a slow one), so the
      // cancel offered here would sit there doing nothing.
      els.go.disabled = true;
      els.go.textContent = 'Finishing archive…';
    }

  } else if (msg.type === 'SCANNED') {
    renderTypes(msg.types);
    const n = msg.types.reduce((a, t) => a + t.count, 0);
    setGoCancels(false);
    setBusy(false);
    setState(msg.partial ? 'Stopped' : 'Ready');
    setPhase('scanned');
    // A stopped scan's counts are a floor, not a total — never imply the chat
    // held only this much.
    log(msg.partial
      ? `Stopped — ${n} items found so far`
      : `Scan complete — ${n} items found`, 'ok');
    markPartial(!!msg.partial);
    showResumable(!!msg.resumable);
    if (msg.partial && !msg.resumable)
      log('Reached the top of the chat — nothing more to scan', 'detail');

  } else if (msg.type === 'DONE') {
    setGoCancels(false);
    setPhase('scanned');
    const saved = Object.entries(msg.counts).map(([k, n]) => `${n} ${k}`).join(', ');
    setState(saved ? 'Complete' : 'Failed', saved ? 'done' : 'fail');
    if (saved) log(`Saved ${saved}`, 'ok');
    else log('Nothing saved', 'err');
    // A DONE means the run finished, so a stop that reached this point missed
    // its window. Saying so beats letting the request vanish into the summary.
    if (stopAsked)
      log('Stop came too late to cancel — the archive was already building', 'detail');
    stopAsked = false;

    // Failures get their own lines: a count buried in a summary gets missed,
    // and the reason is the only thing that makes a failure actionable.
    if (msg.failed) log(`${msg.failed} skipped — media expired`, 'err');
    if (msg.videoFailed) {
      log(`${msg.videoFailed} video${msg.videoFailed > 1 ? 's' : ''} failed`, 'err');
      for (const r of msg.reasons || []) log(r, 'detail');
    }

  } else if (msg.type === 'STOPPED') {
    stopAsked = false;   // the stop landed; nothing to explain
    setPhase('scanned');
    const wasDownload = goCancels();
    setGoCancels(false);
    setBusy(false);
    setState('Stopped');
    // The two phases keep opposite things, so they must not share a message: a
    // scan keeps its manifest, a download discards its archive.
    log(wasDownload ? 'Cancelled — no archive saved' : 'Stopped — keeping what was found', 'ok');
    syncGo();

  } else if (msg.type === 'ERROR') {
    stopAsked = false;
    setPhase('scanned');
    setGoCancels(false);
    setBusy(false);
    setState('Failed', 'fail');
    log(msg.message, 'err');
  }
}
