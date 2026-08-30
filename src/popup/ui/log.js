import { els } from './dom.js';

export const clock = () => new Date().toTimeString().slice(0, 8);

// A repeating progress line (video 3 of 243) would bury everything else, so a
// line tagged transient replaces the previous transient one instead of stacking.
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

export function setState(label, cls = '') {
  els.state.textContent = label;
  document.body.className = cls;
}

export function resetLog() {
  els.status.replaceChildren();
  transient = null;
}
