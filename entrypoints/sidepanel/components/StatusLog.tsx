import { useEffect, useRef } from 'react';
import type { LogLine } from '../hooks/useRunState';

export function StatusLog({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div id="status" ref={ref}>
      {lines.map(l => (
        <div className={`line ${l.kind}`.trim()} key={l.id}>
          <span className="t">{l.time}</span>
          <span className="m">{l.text}</span>
        </div>
      ))}
    </div>
  );
}
