// A run: one scan or one download, from start to finish.
//
// Two invariants, both former bugs, are structural rather than remembered:
//   1. start() constructs fresh state, so a stop cannot leak into a later run.
//   2. abortReason() checks chat before stop, so a result mixing two chats is
//      never offered as a partial.
import { chatKey } from './dom';
import { sleep } from './utils';

// Chat changed underneath the run. The partial result is DISCARDED.
export class Cancelled extends Error {
  constructor(msg = 'Chat changed mid-run') { super(msg); this.name = 'Cancelled'; }
}

// The user asked to stop. The partial result is KEPT.
export class Stopped extends Error {
  constructor(msg = 'Stopped') { super(msg); this.name = 'Stopped'; }
}

let current: Run | null = null;

export interface WaitForOptions {
  budget?: number;
  floor?: number;
  tick?: number;
}

export class Run {
  chatKey: string | null;
  stopping: boolean;

  constructor(chatKey: string | null) {
    this.chatKey = chatKey;
    this.stopping = false;
  }

  // Chat before stop — invariant (2). Exposed for callers that cannot await
  // (an animation frame, a poll) and must decide synchronously.
  abortReason(): Error | null {
    if (this.chatKey !== null && chatKey() !== this.chatKey) return new Cancelled();
    if (this.stopping) return new Stopped();
    return null;
  }

  check(): true {
    const reason = this.abortReason();
    if (reason) throw reason;
    return true;
  }

  async pause(ms: number): Promise<void> {
    await sleep(ms);
    this.check();
  }

  async waitFor(predicate: () => unknown, { budget = 900, floor = 180, tick = 60 }: WaitForOptions = {}): Promise<boolean> {
    const deadline = Date.now() + budget;

    // Polling instantly after a scroll reads a DOM that has not begun updating
    // and would falsely look settled.
    await this.pause(floor);

    while (Date.now() < deadline) {
      let ok = false;
      try { ok = !!predicate(); } catch { ok = false; }
      if (ok) return true;
      await this.pause(tick);
    }
    return false;   // budget spent; the caller proceeds with what rendered
  }

  stop(): void { this.stopping = true; }

  get done(): boolean { return current !== this; }
}

// Any previous run is abandoned: its next checkpoint sees it is no longer
// current and unwinds.
export function startRun(chatKey: string | null): Run {
  current = new Run(chatKey);
  return current;
}

export function currentRun(): Run | null { return current; }

// The run in flight, or a no-op stand-in so a pass stays callable outside a
// run (tests, a direct console call) instead of throwing on a null.
const INERT = new Run(null);
export function run(): Run { return current || INERT; }

export function endRun(r: Run | null): void {
  if (!r || current === r) current = null;
}
