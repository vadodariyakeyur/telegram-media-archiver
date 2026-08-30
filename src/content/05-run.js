// A run: one scan or one download, from start to finish.
//
// Two invariants, both former bugs, are structural rather than remembered:
//   1. start() constructs fresh state, so a stop cannot leak into a later run.
//   2. abortReason() checks chat before stop, so a result mixing two chats is
//      never offered as a partial.

// Chat changed underneath the run. The partial result is DISCARDED.
class Cancelled extends Error {
  constructor(msg = 'Chat changed mid-run') { super(msg); this.name = 'Cancelled'; }
}

// The user asked to stop. The partial result is KEPT.
class Stopped extends Error {
  constructor(msg = 'Stopped') { super(msg); this.name = 'Stopped'; }
}

let current = null;

class Run {
  constructor(chatKey) {
    this.chatKey = chatKey;
    this.stopping = false;
  }

  // Chat before stop — invariant (2). Exposed for callers that cannot await
  // (an animation frame, a poll) and must decide synchronously.
  abortReason() {
    if (this.chatKey !== null && TG.chatKey() !== this.chatKey) return new Cancelled();
    if (this.stopping) return new Stopped();
    return null;
  }

  check() {
    const reason = this.abortReason();
    if (reason) throw reason;
    return true;
  }

  async pause(ms) {
    await TG.sleep(ms);
    this.check();
  }

  async waitFor(predicate, { budget = 900, floor = 180, tick = 60 } = {}) {
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

  stop() { this.stopping = true; }

  get done() { return current !== this; }
}

// Any previous run is abandoned: its next checkpoint sees it is no longer
// current and unwinds.
function startRun(chatKey) {
  current = new Run(chatKey);
  return current;
}

function currentRun() { return current; }

// The run in flight, or a no-op stand-in so a pass stays callable outside a
// run (tests, a direct console call) instead of throwing on a null.
const INERT = new Run(null);
function run() { return current || INERT; }

function endRun(run) {
  if (!run || current === run) current = null;
}

// --- exports ---
TG.Cancelled = Cancelled;
TG.Stopped = Stopped;
TG.startRun = startRun;
TG.currentRun = currentRun;
TG.run = run;
TG.endRun = endRun;
