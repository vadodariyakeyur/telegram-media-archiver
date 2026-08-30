// Translating content-script messages into log lines and run state.
// The only module that knows the message contract's shape.
import { els } from './dom.js';
import { log, setState, resetLog } from './log.js';
import { renderTypes, syncGo, markPartial, updateCounts } from './manifest.js';
import { applyTheme } from './theme.js';

// Every state change routes through here so the two buttons can never both be
// visible, or both hidden.
function setBusy(busy) {
  els.scan.hidden = busy;
  els.stop.hidden = !busy;
  els.stop.disabled = false;
  els.stop.textContent = 'Stop and keep what was found';
  els.scan.disabled = false;
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
    renderTypes(null);
    resetLog();
    setState('Idle');
    setBusy(false);
    showResumable(false);
    if (msg.reason === 'chat-changed') log('Chat changed — run stopped', 'err');
    return;
  }

  // A theme switch touches only the palette. It MUST return before the run
  // state below, which would otherwise read a theme push as "not running" and
  // swap a live scan's Stop button back to Scan.
  if (msg.type === 'THEME') { applyTheme(msg.theme); return; }

  const busy = msg.type === 'PROGRESS';
  setBusy(busy);
  if (busy) els.go.disabled = true; else syncGo();

  if (msg.type === 'PROGRESS') {
    if (msg.phase === 'scanning') {
      setState('Scanning', 'busy');
      log(`Scanning chat — ${msg.count} items`, 'live', { transient: true });
      // Keep the manifest live while the scan runs: a list that only appears at
      // the end made a continued scan look like it had stalled.
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

  } else if (msg.type === 'ERROR') {
    setBusy(false);
    setState('Failed', 'fail');
    log(msg.message, 'err');
  }
}
