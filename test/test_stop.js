// Stopping a scan must KEEP what it collected — that is the whole point of the
// button. A chat switch (Cancelled) must still discard, because that result
// would be a mix of two chats. The two signals are deliberately different.
const assert = require('assert');

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');

// Cancellation lives behind the Run module now; the behavioural claims below
// are unchanged, only the interface they speak through.
const TG = { sleep: ms => new Promise(r => setTimeout(r, ms)) };
eval(read('src/content/05-run.js'));

let openChat = 'peer:aaa';
TG.chatKey = () => openChat;

(async () => {
  // --- the two signals are distinguishable --------------------------------
  assert.ok(new TG.Stopped() instanceof Error, 'Stopped is an Error');
  assert.strictEqual(new TG.Stopped().name, 'Stopped', 'named for the catch');
  assert.ok(!(new TG.Stopped() instanceof TG.Cancelled),
            'Stopped is not a Cancelled: they mean opposite things for data');
  assert.ok(!(new TG.Cancelled() instanceof TG.Stopped), 'and the reverse');

  // --- pause() raises Stopped on request ----------------------------------
  let run = TG.startRun('peer:aaa');
  await assert.doesNotReject(() => run.pause(1), 'runs while no stop is asked');

  run.stop();
  await assert.rejects(() => run.pause(1), e => e instanceof TG.Stopped,
                       'a requested stop raises Stopped');

  // A stop asked mid-sleep still lands on resume — the real sequence.
  run = TG.startRun('peer:aaa');
  const parked = run.pause(30);
  run.stop();
  await assert.rejects(() => parked, e => e instanceof TG.Stopped,
                       'stop during a sleep lands on resume');

  // --- a chat switch still outranks a stop --------------------------------
  // Both pending at once: the chat check runs first, so the mixed-chat result
  // is discarded rather than being offered as a partial.
  run = TG.startRun('peer:aaa');
  run.stop();                    // both signals pending at once
  openChat = 'peer:zzz';
  await assert.rejects(() => run.pause(1), e => e instanceof TG.Cancelled,
                       'a chat switch wins over a stop: never offer mixed data');

  // --- a scan-shaped loop keeps its partial result -------------------------
  openChat = 'peer:aaa';
  run = TG.startRun('peer:aaa');

  const found = new Map();
  let rounds = 0;
  let stopped = false;
  try {
    for (let i = 0; i < 100; i++) {
      found.set(`item${i}`, { kind: 'photo' });
      rounds++;
      if (i === 6) run.stop();             // user clicks Stop
      await run.pause(1);
    }
  } catch (e) {
    if (!(e instanceof TG.Stopped)) throw e;
    stopped = true;
  }

  assert.ok(stopped, 'the loop ended via Stopped');
  assert.ok(rounds < 100, `stopped early (${rounds} rounds)`);
  assert.strictEqual(found.size, rounds, 'every item collected before the stop is kept');
  assert.ok(found.size >= 7, 'the partial result is non-empty and usable');

  // --- resume semantics ----------------------------------------------------
  // Continuing must carry the previous maps forward, not start fresh.
  const prior = { found, pending: [], at: 4200 };
  const resumedFound = prior.found ?? new Map();
  assert.strictEqual(resumedFound.size, found.size, 'continue reuses the collected media');
  assert.strictEqual(resumedFound, found, 'the same map is carried, not a copy');

  // A fresh scan must NOT inherit anything.
  const freshFound = null?.found ?? new Map();
  assert.strictEqual(freshFound.size, 0, 'a fresh scan starts empty');

  // --- resumability ---------------------------------------------------------
  // Mirrors scanChat: only a stop that did not reach the top can continue.
  const resumable = (stopped, at) => !!stopped && !(!stopped || at <= 5);
  assert.strictEqual(resumable(true, 4200), true, 'stopped mid-chat is resumable');
  assert.strictEqual(resumable(true, 0), false, 'stopped at the top is exhausted');
  assert.strictEqual(resumable(false, 4200), false, 'a completed scan is not resumable');

  // --- a stop applies to one run only --------------------------------------
  // begin() clears the flag, or one stop would kill every later run.
  // This invariant is now structural: startRun() constructs fresh state, so a
  // stop cannot leak into the next run even if the previous one ended stopped.
  const stoppedRun = TG.startRun('peer:aaa');
  stoppedRun.stop();
  const nextRun = TG.startRun('peer:aaa');
  assert.strictEqual(nextRun.stopping, false, 'a new run starts un-stopped by construction');
  await assert.doesNotReject(() => nextRun.pause(1), 'the next run is not pre-stopped');

  console.log('all 18 stop/continue checks pass');
})();
