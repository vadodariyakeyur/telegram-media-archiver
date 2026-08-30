// Switching chats mid-scan used to let the pass keep scrolling the NEW chat
// and merge both chats' media into one result — worse than stale data, because
// nothing looked wrong. Every long pass must abort at its next checkpoint.
//
// Cancellation now lives behind the Run module, so these assert through that
// interface rather than against loose namespace flags. The behavioural claims
// are unchanged: they are the ones that were bugs first.
const assert = require('assert');

const ROOT = require('path').join(__dirname, '..');
// True when `at` falls inside a `finally { ... }` body. Brace counting is
// enough here: these files have no braces inside strings or regexes.
function inFinally(src, at) {
  const re = /\bfinally\s*{/g;
  let m;
  while ((m = re.exec(src)) && m.index < at) {
    let depth = 1;
    for (let i = m.index + m[0].length; i < src.length && depth > 0; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      if (i === at) return depth > 0;
    }
  }
  return false;
}

const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');

const TG = { sleep: ms => new Promise(r => setTimeout(r, ms)) };
eval(read('src/content/05-run.js'));

let openChat = 'peer:aaa';
TG.chatKey = () => openChat;

(async () => {
  // --- a run checks the chat it started in --------------------------------
  let run = TG.startRun('peer:aaa');
  assert.doesNotThrow(() => run.check(), 'same chat keeps running');

  openChat = 'peer:bbb';
  assert.throws(() => run.check(), /Chat changed/, 'a switch aborts');
  assert.throws(() => run.check(), e => e instanceof TG.Cancelled,
                'aborts with Cancelled, not a generic Error');

  // A run with no chat (the inert stand-in) has nothing to compare against.
  // Through startRun, not the class: Run is deliberately unexported, and a
  // test is not a reason to widen the module's surface.
  assert.doesNotThrow(() => TG.startRun(null).check(),
                      'a run outside any chat never self-cancels');

  // --- the two signals stay distinguishable -------------------------------
  assert.ok(new TG.Cancelled() instanceof Error, 'Cancelled is an Error');
  assert.ok(new TG.Stopped() instanceof Error, 'Stopped is an Error');
  assert.ok(!(new TG.Stopped() instanceof TG.Cancelled),
            'Stopped is not a Cancelled: they mean opposite things for data');

  // --- pause() is the checkpoint every loop awaits ------------------------
  openChat = 'peer:aaa';
  run = TG.startRun('peer:aaa');
  await assert.doesNotReject(() => run.pause(1), 'pause resumes in the same chat');

  openChat = 'peer:ccc';
  await assert.rejects(() => run.pause(1), /Chat changed/, 'pause aborts after a switch');

  // A switch DURING the sleep must still abort on resume — the real sequence.
  openChat = 'peer:aaa';
  run = TG.startRun('peer:aaa');
  const parked = run.pause(30);
  openChat = 'peer:ddd';
  await assert.rejects(() => parked, /Chat changed/, 'switch mid-sleep aborts on resume');

  // --- a scan-shaped loop unwinds and keeps nothing from the new chat -----
  openChat = 'peer:aaa';
  run = TG.startRun('peer:aaa');
  let rounds = 0;
  const collected = [];
  const loop = (async () => {
    for (let i = 0; i < 50; i++) { rounds++; collected.push(openChat); await run.pause(1); }
  })();
  setTimeout(() => { openChat = 'peer:eee'; }, 8);
  await assert.rejects(() => loop, /Chat changed/, 'scan-shaped loop unwinds');
  assert.ok(rounds < 50, `loop stopped early (${rounds} rounds), did not run to completion`);
  assert.ok(collected.every(c => c === 'peer:aaa'),
            'no media from the new chat was mixed into the run');

  // --- every long pass still awaits a cancellable checkpoint --------------
  // Assert the PROPERTY, not one spelling: pause(), waitFor() and glideTo()
  // all abort on resume, so requiring a literal name would fail on a correct
  // refactor — as it did when cancellation moved behind Run.
  const CANCELLABLE = /await TG\.(run\(\)\.(pause|waitFor)|glideTo)\(/;
  for (const f of ['src/content/50-scan.js', 'src/content/60-locate.js',
                   'src/content/70-collect.js', 'src/content/40-viewer.js']) {
    const s = read(f);
    assert.ok(CANCELLABLE.test(s), `${f} awaits a cancellable checkpoint`);
    // Raw sleep is allowed inside a finally and ONLY there: a throw from a
    // finally replaces the pending break, unwinding a pass that had already
    // stopped cleanly and discarding everything it fetched (see 70-collect.js).
    for (const line of s.split('\n')) {
      if (!/await TG\.sleep\(/.test(line)) continue;
      assert.ok(inFinally(s, s.indexOf(line)),
                `${f} awaits raw sleep() outside a finally: it would not abort`);
    }
  }

  // The helpers those passes rely on must themselves abort, or the property
  // above is satisfied by a checkpoint that never actually checks.
  const runSrc = read('src/content/05-run.js');
  assert.ok(/async waitFor[\s\S]*this\.pause\(/.test(runSrc),
            'waitFor polls through pause(), so it aborts mid-wait');

  // The two sites that cannot await must read the reason synchronously.
  for (const f of ['src/content/10-dom.js', 'src/content/30-bridge.js']) {
    assert.ok(/abortReason\(\)/.test(read(f)),
              `${f} aborts via abortReason() rather than finishing its work`);
  }

  // --- no module reaches for the old raw flags ----------------------------
  for (const f of read('manifest.json').match(/src\/content\/[\w-]+\.js/g)) {
    assert.ok(!/TG\.(runKey|stopRequested|requestStop|checkChat)\b/.test(read(f)),
              `${f} must not read the retired cancellation flags`);
  }

  console.log('all 20 cancellation checks pass');
})();
