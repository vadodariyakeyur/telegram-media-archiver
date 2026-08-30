// A run: one scan or one download, from start to finish.
//
// Cancellation used to be five loose pieces of state on the shared namespace
// (runKey, stopRequested, two error classes, and the verbs that read them),
// coordinated by hand across four modules. Two invariants lived only in
// comments, and both had been bugs first:
//
//   1. The stop flag must be cleared when a run starts, or one stop kills
//      every later run.
//   2. A chat switch outranks a stop, so a result mixing two chats is never
//      offered as a partial.
//
// Both are now structural. start() constructs fresh state, so (1) cannot be
// forgotten; abort() checks chat before stop, so (2) holds for every caller.

// Ends a run because the chat changed underneath it. The partial result is
// DISCARDED: it would mix media from two chats.
class Cancelled extends Error {
  constructor(msg = 'Chat changed mid-run') { super(msg); this.name = 'Cancelled'; }
}

// Ends a run because the user asked. The partial result is KEPT — using it is
// the whole point of stopping.
class Stopped extends Error {
  constructor(msg = 'Stopped') { super(msg); this.name = 'Stopped'; }
}

// The run in flight, or null. Module-private: callers hold the run object
// they were handed, and the checkpoints below read this.
let current = null;

class Run {
  constructor(chatKey) {
    this.chatKey = chatKey;
    this.stopping = false;   // fresh per run — invariant (1), structurally
  }

  // Why this run should end, or null to keep going. Chat before stop —
  // invariant (2). Exposed for callers that cannot await (an animation frame,
  // a poll) and must decide synchronously.
  abortReason() {
    if (this.chatKey !== null && TG.chatKey() !== this.chatKey) return new Cancelled();
    if (this.stopping) return new Stopped();
    return null;
  }

  // Throw if this run should end. The synchronous checkpoint.
  check() {
    const reason = this.abortReason();
    if (reason) throw reason;
    return true;
  }

  // Sleep, then check. Every long pass already awaits between steps, so this
  // is the natural place for a checkpoint: an abort lands within one step.
  async pause(ms) {
    await TG.sleep(ms);
    this.check();
  }

  // Wait for a condition instead of guessing a duration.
  //
  // A pass's per-step wait exists so Telegram can render what just scrolled
  // into view — an observable condition. A responsive chat proceeds in about
  // the floor; a lagging one still gets the full budget. Aborts on every
  // tick, so a stop lands mid-wait rather than after it.
  async waitFor(predicate, { budget = 900, floor = 180, tick = 60 } = {}) {
    const deadline = Date.now() + budget;

    // A minimum beat first: polling instantly after a scroll reads a DOM that
    // has not begun updating and would falsely look settled.
    await this.pause(floor);

    while (Date.now() < deadline) {
      let ok = false;
      try { ok = !!predicate(); } catch { ok = false; }
      if (ok) return true;
      await this.pause(tick);
    }
    return false;   // budget spent; the caller proceeds with what rendered
  }

  // Ask this run to stop. Idempotent.
  stop() { this.stopping = true; }

  get done() { return current !== this; }
}

// Start a run in the given chat, making it current. Any previous run is
// abandoned: its next checkpoint sees it is no longer current and unwinds.
function startRun(chatKey) {
  current = new Run(chatKey);
  return current;
}

// The run in flight, or null.
function currentRun() { return current; }

// The run in flight, or a no-op stand-in.
//
// A pass always executes inside a run, so its checkpoints read it ambiently
// rather than taking it as a parameter — threading `run` through every
// signature would widen each pass's interface to say something already true.
// The stand-in keeps a pass callable outside a run (tests, a direct console
// call) instead of throwing on a null.
const INERT = new Run(null);
function run() { return current || INERT; }

// Clear the current run. Idempotent, and safe to call for a run that has
// already been replaced.
function endRun(run) {
  if (!run || current === run) current = null;
}

// --- exports ---
TG.Run = Run;
TG.Cancelled = Cancelled;
TG.Stopped = Stopped;
TG.startRun = startRun;
TG.currentRun = currentRun;
TG.run = run;
TG.endRun = endRun;
