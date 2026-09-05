import { useReducer } from 'react';

export interface TypeRow { kind: string; label: string; count: number }

export interface LogLine { id: number; time: string; text: string; kind: string; transient: boolean }

export interface RunState {
  stateLabel: string;
  stateClass: string;
  phase: string;           // mirrors hint.js's phase: idle | scanning | fetching | zipping | scanned
  busy: boolean;
  fetching: boolean;       // sub-phase of a download: videos | downloading | zipping
  goCancels: boolean;      // Go button doubles as the download's cancel while true
  goDisabled: boolean;
  goLabel: string | null;  // non-null overrides the label the panel would compute from selection
  stopHidden: boolean;
  stopDisabled: boolean;
  stopLabel: string;
  resumable: boolean;
  types: TypeRow[] | null;
  partial: boolean;
  lines: LogLine[];
  stopAsked: boolean;
}

// Any incoming push from content.ts, plus two UI-only actions (RESET_LOG /
// GO_LABEL) that main.js used to perform as side effects on click.
export type RunAction =
  | { type: 'RESET'; reason?: string }
  | { type: 'PROGRESS'; phase: string; count?: number; types?: TypeRow[]; done?: number; total?: number; pct?: number | null; searching?: boolean }
  | { type: 'SCANNED'; types: TypeRow[]; partial: boolean; resumable: boolean }
  | { type: 'DONE'; counts: Record<string, number>; failed?: number; videoFailed?: number; reasons?: string[]; fetchFailed?: number }
  | { type: 'STOPPED' }
  | { type: 'ERROR'; message: string }
  | { type: 'STOP_ASKED' }
  | { type: 'UNREACHABLE' }
  | { type: 'SCAN_STARTED' }
  | { type: 'CONTINUE_STARTED' };

const clock = () => new Date().toTimeString().slice(0, 8);

let lineSeq = 0;
function appendLine(lines: LogLine[], text: string, kind = '', transient = false): LogLine[] {
  const row: LogLine = { id: ++lineSeq, time: clock(), text, kind, transient };
  // A repeating progress line would bury everything else, so a transient line
  // replaces the previous transient one instead of stacking.
  if (transient && lines.length && lines[lines.length - 1].transient) {
    return [...lines.slice(0, -1), row];
  }
  return [...lines, row];
}

const initial: RunState = {
  stateLabel: 'Idle',
  stateClass: '',
  phase: 'idle',
  busy: false,
  fetching: false,
  goCancels: false,
  goDisabled: true,
  goLabel: null,
  stopHidden: true,
  stopDisabled: false,
  stopLabel: 'Stop and keep what was found',
  resumable: false,
  types: null,
  partial: false,
  lines: [],
  stopAsked: false,
};

function reduce(s: RunState, msg: RunAction): RunState {
  if (msg.type === 'RESET') {
    return {
      ...initial,
      lines: msg.reason === 'chat-changed'
        ? appendLine([], 'Chat changed — run stopped', 'err')
        : [],
    };
  }

  if (msg.type === 'UNREACHABLE') {
    return { ...s, stateLabel: 'No chat', stateClass: 'fail', goDisabled: true };
  }

  if (msg.type === 'SCAN_STARTED') {
    return { ...initial, stateLabel: 'Scanning', stateClass: 'busy', lines: [] };
  }

  if (msg.type === 'CONTINUE_STARTED') {
    // Continue keeps the existing manifest and log: this is one scan
    // resuming, not a new one.
    return { ...s, resumable: false, stateLabel: 'Scanning', stateClass: 'busy',
      lines: appendLine(s.lines, 'Continuing scan', 'live') };
  }

  if (msg.type === 'STOP_ASKED') {
    const stoppingLabel = 'Stopping…';
    return {
      ...s,
      stopAsked: true,
      // Whichever button was pressed is the one that acknowledges — the
      // other is already hidden for this phase.
      stopDisabled: s.goCancels ? s.stopDisabled : true,
      stopLabel: s.goCancels ? s.stopLabel : stoppingLabel,
      goDisabled: s.goCancels ? true : s.goDisabled,
      goLabel: s.goCancels ? stoppingLabel : s.goLabel,
      lines: appendLine(s.lines, 'Stop requested — finishing the current step', 'live'),
    };
  }

  // A theme/page push never reaches this reducer (App.tsx routes THEME/PAGE
  // to useTheme/hint state directly) — same reason render.js returned early:
  // falling through here would read them as "not running" and reset a live
  // run's UI mid-scan.

  const busy = msg.type === 'PROGRESS';
  // 'scanning' is the only phase that is not a download; fetching,
  // downloading and zipping are all stages of one.
  const fetching = busy && (msg as { phase?: string }).phase !== 'scanning';
  // Only a SCAN swaps the Stop slot in: it is the run's only abort. A
  // download cancels from its own (Go) button instead, so scanning just
  // greys Scan out — a second abort would give one run two of them.
  const scanning = busy && !fetching;
  let next: RunState = {
    ...s,
    busy,
    fetching,
    stopHidden: !scanning,
    stopDisabled: false,
    stopLabel: 'Stop and keep what was found',
    goCancels: fetching,
    // Past the point of no return (zipping) Go is force-disabled below;
    // otherwise it degrades to whatever the manifest selection computes.
    goDisabled: scanning ? true : (fetching ? false : false),
    goLabel: fetching ? 'Cancel download' : null,
  };

  if (msg.type === 'PROGRESS') {
    if (msg.phase === 'scanning') {
      next = { ...next, stateLabel: 'Scanning', stateClass: 'busy', phase: 'scanning',
        lines: appendLine(next.lines, `Scanning chat — ${msg.count} items`, 'live', true) };
      // Keep the manifest live while the scan runs: a list that only
      // appears at the end made a continued scan look like it had stalled.
      if (msg.types) next = { ...next, types: mergeCounts(next.types, msg.types), partial: true };

    } else if (msg.phase === 'videos') {
      const text = msg.searching
        ? `Video ${(msg.done ?? 0) + 1}/${msg.total} — searching chat`
        : `Video ${(msg.done ?? 0) + 1}/${msg.total}${msg.pct != null ? ` — ${msg.pct}%` : ''}`;
      next = { ...next, stateLabel: 'Downloading', stateClass: 'busy', phase: 'fetching',
        lines: appendLine(next.lines, text, 'live', true) };

    } else if (msg.phase === 'downloading') {
      next = { ...next, stateLabel: 'Collecting', stateClass: 'busy', phase: 'fetching',
        lines: appendLine(next.lines, `Collecting ${(msg.done ?? 0) + 1}/${msg.total}`, 'live', true) };

    } else if (msg.phase === 'zipping') {
      // Past the point of no return: the archive step has no abort
      // checkpoints (a half-written zip is worse than a slow one), so a
      // cancel offered here would sit there doing nothing.
      next = { ...next, stateLabel: 'Packing', stateClass: 'busy', phase: 'zipping',
        goDisabled: true, goLabel: 'Finishing archive…',
        lines: appendLine(next.lines, 'Building archive', 'live') };
    }
    return next;
  }

  if (msg.type === 'SCANNED') {
    const n = msg.types.reduce((a, t) => a + t.count, 0);
    // A stopped scan's counts are a floor, not a total — never imply the
    // chat held only this much.
    let lines = appendLine(next.lines,
      msg.partial ? `Stopped — ${n} items found so far` : `Scan complete — ${n} items found`, 'ok');
    if (msg.partial && !msg.resumable) {
      lines = appendLine(lines, 'Reached the top of the chat — nothing more to scan', 'detail');
    }
    return {
      ...next,
      types: msg.types,
      goCancels: false,
      busy: false,
      fetching: false,
      stopHidden: true,
      stateLabel: msg.partial ? 'Stopped' : 'Ready',
      stateClass: '',
      phase: 'scanned',
      partial: !!msg.partial,
      resumable: !!msg.resumable,
      goLabel: null,
      goDisabled: false,
      lines,
    };
  }

  if (msg.type === 'DONE') {
    const saved = Object.entries(msg.counts).map(([k, c]) => `${c} ${k}`).join(', ');
    let lines = appendLine(next.lines, saved ? `Saved ${saved}` : 'Nothing saved', saved ? 'ok' : 'err');
    // A DONE means the run finished, so a stop that reached this point
    // missed its window. Saying so beats letting the request vanish into
    // the summary.
    if (s.stopAsked) lines = appendLine(lines, 'Stop came too late to cancel — the archive was already building', 'detail');
    // Failures get their own lines: a count buried in a summary gets
    // missed, and the reason is the only thing that makes it actionable.
    if (msg.failed) lines = appendLine(lines, `${msg.failed} skipped — media expired`, 'err');
    if (msg.videoFailed) {
      lines = appendLine(lines, `${msg.videoFailed} video${msg.videoFailed > 1 ? 's' : ''} failed`, 'err');
      for (const r of msg.reasons || []) lines = appendLine(lines, r, 'detail');
    }
    return {
      ...next,
      goCancels: false,
      phase: 'scanned',
      stateLabel: saved ? 'Complete' : 'Failed',
      stateClass: saved ? 'done' : 'fail',
      stopAsked: false,
      goLabel: null,
      lines,
    };
  }

  if (msg.type === 'STOPPED') {
    // The two phases keep opposite things, so they must not share a
    // message: a scan keeps its manifest, a download discards its archive.
    const wasDownload = s.goCancels;
    return {
      ...next,
      stopAsked: false,
      phase: 'scanned',
      goCancels: false,
      busy: false,
      fetching: false,
      stopHidden: true,
      stateLabel: 'Stopped',
      stateClass: '',
      goLabel: null,
      lines: appendLine(next.lines, wasDownload ? 'Cancelled — no archive saved' : 'Stopped — keeping what was found', 'ok'),
    };
  }

  if (msg.type === 'ERROR') {
    return {
      ...next,
      stopAsked: false,
      phase: 'scanned',
      goCancels: false,
      busy: false,
      fetching: false,
      stopHidden: true,
      stateLabel: 'Failed',
      stateClass: 'fail',
      goLabel: null,
      lines: appendLine(next.lines, msg.message, 'err'),
    };
  }

  return s;
}

// Merge new counts into the existing rows without discarding rows the
// caller isn't reporting on this tick — mirrors updateCounts() vs a full
// renderTypes() rebuild, so ManifestList's own selection state (per-row
// checked) is never invalidated by props changing identity mid-scan.
function mergeCounts(prev: TypeRow[] | null, incoming: TypeRow[]): TypeRow[] {
  const byKind = new Map((prev ?? []).map(t => [t.kind, t]));
  for (const t of incoming) byKind.set(t.kind, t);
  return [...byKind.values()];
}

export function useRunState() {
  return useReducer(reduce, initial);
}
