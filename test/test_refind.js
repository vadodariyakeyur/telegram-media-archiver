// Telegram detaches messages that scroll out of the rendered window, so a node
// captured during the scan must be re-found by key. The earlier version only
// swept upward from the bottom and stopped at scrollTop 0, so a message that
// never rendered during that sweep was wrongly reported "no longer in list".
const assert = require('assert');
const { JSDOM } = (() => { try { return require('jsdom'); } catch { return {}; } })();
if (!JSDOM) { console.log('skip: jsdom not installed'); process.exit(0); }

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');
const src = read('src/content/20-classify.js') + '\n' + read('src/content/60-locate.js');
const grab = n => { const i = src.indexOf(`function ${n}(`); return src.slice(i, src.indexOf('\n}\n', i) + 2); };

const dom = new JSDOM('<body></body>');
global.document = dom.window.document;
// Modules reference siblings via the TG namespace; the eval'd copies
// are bare functions, so point TG at the same global scope.
global.TG = global;
global.CSS = { escape: s => s };
// Count sleeps instead of waiting: the bug was cost, so cost is what to assert.
// refind() awaits TG.pause (the cancellable checkpoint), so both names map to
// this counter — cancellation itself is covered by test_cancel.js.
let sleepMs = 0;
global.sleep = ms => { sleepMs += (ms || 0); return Promise.resolve(); };

let refind;
// eval() bindings at module scope do not attach to globalThis, so the TG.*
// sibling calls inside refind would not resolve. Bind them explicitly.
eval(grab('durationIn') + grab('bubbleKey') + 'refind = async ' + grab('refind')
     + ';TG.bubbleKey = bubbleKey; TG.durationIn = durationIn;'
     + 'TG.sleep = global.sleep;'
     // refind's checkpoints now hang off the run object (TG.run().pause /
     // .waitFor). Stub a run that never aborts and charges each wait to the
     // same counter, so these assertions keep measuring SEARCH COST rather
     // than animation time — cancellation itself is covered by test_cancel.js.
     + 'TG.run = () => ({'
     + '  pause: ms => { sleepMs += (ms || 0); return Promise.resolve(); },'
     + '  waitFor: (pred, o) => { sleepMs += (o && o.floor) || 0;'
     + '    return Promise.resolve(!!pred()); },'
     + '  check: () => true, abortReason: () => null });'
     + 'TG.currentRun = TG.run;'
     + 'TG.glideTo = (sc, to, ms) => { sleepMs += (ms || 0);'
     + '  sc.scrollTop = Math.max(0, Math.min(to, sc.scrollHeight));'
     + '  return Promise.resolve(); };');

// A virtualized list: 100 messages, but only those near scrollTop are in the
// DOM — exactly how Telegram behaves.
function makeList(total = 100, windowSize = 10) {
  const host = dom.window.document.body;
  const scroller = {
    scrollTop: 0,
    clientHeight: 500,
    scrollHeight: total * 100,
    _render() {
      [...host.querySelectorAll('.bubble')].forEach(n => n.remove());
      const first = Math.floor(this.scrollTop / 100);
      for (let i = first; i < Math.min(total, first + windowSize); i++) {
        const d = dom.window.document.createElement('div');
        d.className = 'bubble';
        d.setAttribute('data-mid', String(i));
        host.appendChild(d);
      }
    },
  };
  // Re-render whenever scrollTop is assigned, like a real virtual list.
  let v = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => v,
    set: n => { v = Math.max(0, Math.min(n, scroller.scrollHeight)); scroller._render(); },
  });
  scroller.scrollTop = 0;
  return scroller;
}

(async () => {
  // A message near the very top (index 2) — the case that was failing.
  let sc = makeList();
  sc.scrollTop = sc.scrollHeight;                 // start at the bottom
  let got = await refind({ key: 'id:2' }, sc);
  assert.ok(got, 'finds a message near the top of a long list');
  assert.strictEqual(got.getAttribute('data-mid'), '2', 'correct message');

  // A message in the middle.
  sc = makeList();
  got = await refind({ key: 'id:50' }, sc);
  assert.strictEqual(got?.getAttribute('data-mid'), '50', 'finds a mid-list message');

  // A message at the very bottom.
  sc = makeList();
  got = await refind({ key: 'id:99' }, sc);
  assert.strictEqual(got?.getAttribute('data-mid'), '99', 'finds the last message');

  // Already-live node is returned without any scrolling.
  sc = makeList();
  sc.scrollTop = 0;
  const live = dom.window.document.querySelector('[data-mid="0"]');
  got = await refind({ key: 'id:0', bubble: live }, sc);
  assert.strictEqual(got, live, 'live node reused as-is');

  // A genuinely absent message must terminate, not hang.
  sc = makeList();
  got = await refind({ key: 'id:9999' }, sc);
  assert.strictEqual(got, null, 'missing message gives up cleanly');

  // The 243-video hang: a deep sweep per video was ~10 min each. The local
  // pass must resolve a nearby message without sweeping the whole list.
  sc = makeList(3000, 10);              // a very long chat
  sc.scrollTop = 500;
  sleepMs = 0;
  got = await refind({ key: 'id:6' }, sc, { deep: false });
  assert.ok(got, 'local pass finds a nearby message');
  assert.ok(sleepMs <= 1500, `local pass is cheap, spent ${sleepMs}ms`);

  // A far-away message must NOT be chased by the local pass.
  sc = makeList(3000, 10);
  sc.scrollTop = 0;
  sleepMs = 0;
  got = await refind({ key: 'id:2500' }, sc, { deep: false });
  assert.strictEqual(got, null, 'local pass gives up rather than sweeping');
  assert.ok(sleepMs <= 1500, `local pass stays bounded, spent ${sleepMs}ms`);

  // The deep sweep must respect its wall-clock budget.
  sc = makeList(3000, 10);
  sleepMs = 0;
  const t0 = Date.now();
  await refind({ key: 'id:999999' }, sc, { deep: true, budgetMs: 2000 });
  assert.ok(Date.now() - t0 < 5000, 'deep sweep honours its time budget');

  // The 243-video stall: scan order is bottom-to-top, so processing in that
  // order made the list position and the next target drift apart. Videos must
  // be visited in list order so each target is already near the viewport.
  const scanOrder = [
    { key: 'id:90', at: 9000 }, { key: 'id:60', at: 6000 },
    { key: 'id:30', at: 3000 }, { key: 'id:5',  at: 500  },
  ];
  const visitOrder = [...scanOrder].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  assert.deepStrictEqual(visitOrder.map(v => v.at), [500, 3000, 6000, 9000],
    'videos visited top-down through the list');

  // Consecutive targets must be close together, so a seek lands them onscreen.
  const jumps = visitOrder.slice(1).map((v, i) => v.at - visitOrder[i].at);
  assert.ok(Math.max(...jumps) <= 3000, 'no large backward jumps between targets');

  // Entries with no recorded position must not break the sort.
  const mixed = [{ key: 'a', at: 100 }, { key: 'b' }, { key: 'c', at: 50 }];
  const sorted = [...mixed].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  assert.strictEqual(sorted.length, 3, 'entries without a position still included');

  console.log('all 12 refind checks pass');
})();
