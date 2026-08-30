// Translating content-script messages into log lines and run state.
// This is the only module that knows the message contract's shape.
import { els } from './dom.js';
import { log, setState, resetLog } from './log.js';
import { renderTypes, syncGo, markPartial, updateCounts } from './manifest.js';

// Swap Scan for Stop. Every state change routes through here so the two
// buttons can never both be visible, or both hidden.
export function setBusy(busy) {
  els.scan.hidden = busy;
  els.stop.hidden = !busy;
  els.stop.disabled = false;
  els.stop.textContent = 'Stop and keep what was found';
  els.scan.disabled = false;
  // Continue only belongs to the idle state, and only when the last pass
  // actually left something to resume — set by showResumable().
  if (busy) els.more.hidden = true;
}

// Offer Continue when a stopped scan can still be resumed. Kept separate from
// setBusy so a finished or exhausted scan never shows a button that would
// immediately report "already at the top".
export function showResumable(yes) {
  els.more.hidden = !yes;
  els.more.disabled = false;
  els.more.textContent = 'Continue scanning';
}

export function render(msg) {
  if (!msg) return;

  // The open chat changed, so anything on screen describes a different chat.
  // Clear it rather than leaving a manifest the buttons no longer act on.
  if (msg.type === 'RESET') {
    renderTypes(null);
    resetLog();
    setState('Idle');
    setBusy(false);
    showResumable(false);
    // A run that was cancelled mid-flight needs saying: the user watched a
    // scan running and would otherwise just see it vanish.
    if (msg.reason === 'chat-changed') log('Chat changed — run stopped', 'err');
    return;
  }

  const busy = msg.type === 'PROGRESS';
  // Stop takes Scan's place while a run is in flight, so the panel does not
  // reflow and there is always a live control rather than a dead button.
  setBusy(busy);
  if (busy) els.go.disabled = true; else syncGo();

  if (msg.type === 'PROGRESS') {
    // Repeating progress replaces its own previous line; phase changes and
    // outcomes stack, so the log stays a readable record of the whole run.
    if (msg.phase === 'scanning') {
      setState('Scanning', 'busy');
      log(`Scanning chat — ${msg.count} items`, 'live', { transient: true });
      // Keep the manifest live while the scan runs: the counts are already
      // known each round, and a list that only appears at the end made a
      // continued scan look like it had stalled.
      // Rows arrive already labelled from the content script, which owns the
      // type names — the popup keeps no second copy to drift from.
      if (msg.types) {
        updateCounts(msg.types);
        markPartial(true);   // still climbing; these are a floor
      }

    } else if (msg.phase === 'videos') {
      setState('Downloading', 'busy');
      // A deep search scrolls the whole list; say so, or it reads as a hang.
      log(msg.searching
        ? `Video ${msg.done + 1}/${msg.total} — searching chat`
        : `Video ${msg.done + 1}/${msg.total}${msg.pct != null ? ` — ${msg.pct}%` : ''}`,
        'live', { transient: true });

    } else if (msg.phase === 'downloading') {
      setState('Collecting', 'busy');
      log(`Collecting ${msg.done + 1}/${msg.total}`, 'live', { transient: true });

    } else if (msg.phase === 'zipping') {
      setState('Packing', 'busy');
      log('Building archive', 'live');
    }

  } else if (msg.type === 'SCANNED') {
    renderTypes(msg.types);
    const n = msg.types.reduce((a, t) => a + t.count, 0);
    setBusy(false);
    setState(msg.partial ? 'Stopped' : 'Ready');
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
    const saved = Object.entries(msg.counts).map(([k, n]) => `${n} ${k}`).join(', ');
    setState(saved ? 'Complete' : 'Failed', saved ? 'done' : 'fail');
    if (saved) log(`Saved ${saved}`, 'ok');
    else log('Nothing saved', 'err');

    // Failures get their own lines: a count buried in a summary gets missed,
    // and the reason is the only thing that makes a failure actionable.
    if (msg.failed) log(`${msg.failed} skipped — media expired`, 'err');
    if (msg.videoFailed) {
      log(`${msg.videoFailed} video${msg.videoFailed > 1 ? 's' : ''} failed`, 'err');
      for (const r of msg.reasons || []) log(r, 'detail');
    }

  } else if (msg.type === 'STOPPED') {
    setBusy(false);
    setState('Stopped');
    log('Stopped — keeping what was found', 'ok');
    syncGo();
    // A scan reports its own resumability via SCANNED; this path covers a
    // stopped download, which has nothing to resume.

  } else if (msg.type === 'ERROR') {
    setBusy(false);
    setState('Failed', 'fail');
    log(msg.message, 'err');
  }
}

// The popup is destroyed whenever it loses focus, so pull current state back
// from the content script each time it opens.
