// The transfer log: an append-only record of a run.
//
// The status area is the popup's signature element. A long run leaves a
// readable history instead of one overwritten string, so phase changes and
// outcomes stack while repeating progress replaces its own last line.
import { els } from './dom.js';

export const clock = () => new Date().toTimeString().slice(0, 8);

// The log is append-only, but a repeating progress line (video 3 of 243) would
// bury everything else — so a line tagged as transient replaces the previous
// transient one instead of stacking.
let transient = null;

export function log(text, kind = '', { transient: isTransient = false } = {}) {
  const row = document.createElement('div');
  row.className = `line ${kind}`.trim();

  const t = document.createElement('span');
  t.className = 't';
  t.textContent = clock();

  const m = document.createElement('span');
  m.className = 'm';
  m.textContent = text;

  row.append(t, m);

  if (isTransient && transient?.isConnected) transient.replaceWith(row);
  else els.status.append(row);

  transient = isTransient ? row : null;
  els.status.scrollTop = els.status.scrollHeight;
  return row;
}

// Run state drives the masthead lamp: accent pulsing while working, green on
// success, red on failure. One accent, used only where it means something.
export function setState(label, cls = '') {
  els.state.textContent = label;
  document.body.className = cls;
}

// Clear the log and forget the transient line. Used when a new run starts.
export function resetLog() {
  els.status.replaceChildren();
  transient = null;
}
