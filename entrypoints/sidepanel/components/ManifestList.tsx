import { useEffect, useState } from 'react';
import type { TypeRow } from '../hooks/useRunState';

export function ManifestList({
  types,
  partial,
  onSelectionChange,
}: {
  types: TypeRow[] | null;
  partial: boolean;
  onSelectionChange: (selected: string[]) => void;
}) {
  // Checkboxes are the single source of truth in the original (ui/manifest.js);
  // here that becomes this component's own state instead of a parallel copy
  // owned by the reducer, so a running scan's changing `types` reference can
  // never fight the user's clicks.
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!types) return;
    // A row appearing for the first time starts checked, exactly like
    // buildRow()'s cb.checked = true — whether that happens at the end of a
    // scan or mid-scan via a later tick.
    setChecked(prev => {
      let changed = false;
      const next = { ...prev };
      for (const t of types) {
        if (!(t.kind in next)) { next[t.kind] = true; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [types]);

  useEffect(() => {
    onSelectionChange(Object.entries(checked).filter(([, v]) => v).map(([k]) => k));
    // onSelectionChange intentionally excluded: it's a fresh closure from the
    // parent every render, and including it would re-fire this effect on every
    // parent render instead of only on an actual selection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  if (!types?.length) return <div id="types" className="empty" />;

  const setAll = (v: boolean) => setChecked(Object.fromEntries(types.map(t => [t.kind, v])));

  return (
    <div id="types">
      <div className={`bar${partial ? ' partial' : ''}`}>
        <a onClick={() => setAll(true)}>Select all</a>
        {'·'}
        <a onClick={() => setAll(false)}>Clear</a>
      </div>
      {types.map(t => (
        <div className="row" key={t.kind}>
          <input
            type="checkbox"
            id={`t_${t.kind}`}
            checked={checked[t.kind] ?? true}
            onChange={e => setChecked(prev => ({ ...prev, [t.kind]: e.target.checked }))}
          />
          <label htmlFor={`t_${t.kind}`}>{t.label}</label>
          <span className="n">{t.count}</span>
        </div>
      ))}
    </div>
  );
}
