// Selection state lives in the checkboxes themselves rather than a parallel
// copy, so the two can never disagree.
import { els } from './dom.js';

export const selected = () =>
  [...els.types.querySelectorAll('input:checked')].map(c => c.value);

export function syncGo() {
  const n = selected().length;
  els.go.disabled = n === 0;
  els.go.textContent = n ? `Download selected (${n})` : 'Download selected';
}

// Shared by renderTypes() and updateCounts() so a row added mid-scan is
// identical to one built at the end of a pass.
function buildRow(t) {
  const row = document.createElement('div');
  row.className = 'row';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = t.kind;
  cb.id = `t_${t.kind}`;
  cb.checked = true;
  cb.onchange = syncGo;

  const label = document.createElement('label');
  label.htmlFor = cb.id;
  label.textContent = t.label;

  const n = document.createElement('span');
  n.className = 'n';
  n.textContent = t.count;

  row.append(cb, label, n);
  return row;
}

export function renderTypes(types) {
  els.types.replaceChildren();
  if (els.hint) els.hint.hidden = !!types?.length;
  if (!types?.length) { els.types.className = 'empty'; els.go.hidden = true; return; }

  const bar = document.createElement('div');
  bar.className = 'bar';
  const all = document.createElement('a'), none = document.createElement('a');
  all.textContent = 'Select all'; none.textContent = 'Clear';
  const setAll = v => {
    els.types.querySelectorAll('input').forEach(c => { c.checked = v; });
    syncGo();
  };
  all.onclick = () => setAll(true);
  none.onclick = () => setAll(false);
  bar.append(all, document.createTextNode('·'), none);
  els.types.append(bar);

  for (const t of types) els.types.append(buildRow(t));

  els.types.className = '';
  els.go.hidden = false;
  syncGo();
}

// A stopped scan counted only what it reached, so the header says so instead of
// implying the chat held nothing more.
export function markPartial(partial) {
  const bar = els.types.querySelector('.bar');
  if (bar) bar.classList.toggle('partial', !!partial);
}

// Update counts in place during a running scan. renderTypes() rebuilds the
// list, which would discard the user's checkbox selection on every tick.
export function updateCounts(types) {
  if (!types?.length) return;

  if (!els.types.querySelector('.row')) { renderTypes(types); return; }

  for (const t of types) {
    const cb = els.types.querySelector(`input[value="${CSS.escape(t.kind)}"]`);
    if (cb) {
      const n = cb.parentElement.querySelector('.n');
      if (n) n.textContent = t.count;
      continue;
    }
    els.types.append(buildRow(t));
  }
  syncGo();
}
