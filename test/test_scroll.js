// The scan loop reads scrollTop right after moving, to decide whether it
// moved, whether the list grew, and whether it reached the top. An animated
// scroll that resolves mid-flight would make those reads lie and stop the
// scan early — silently losing media. glideTo must land before it resolves.
const assert = require('assert');

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');

// Minimal rAF/perf shims: run the animation fast but in real steps.
let now = 0;
global.performance = { now: () => now };
global.requestAnimationFrame = cb => setTimeout(() => { now += 16; cb(now); }, 0);
global.matchMedia = () => ({ matches: false });

const src = read('src/content/10-dom.js');
const grab = n => { const i = src.indexOf(`function ${n}(`); return src.slice(i, src.indexOf('\n}\n', i) + 2); };
// glideTo aborts mid-animation by asking the current run for a reason, so the
// sandbox supplies a TG with one. Default is "nothing to cancel"; the abort
// tests below swap in a run that does.
const runWith = reason => ({ currentRun: () => ({ abortReason: () => reason }) });
const quietTG = runWith(null);

// grab() slices from `function name(`, dropping any `async ` prefix, so
// re-add it — the body awaits and would otherwise be a syntax error.
const makeGlide = (mm = global.matchMedia, TG = quietTG) =>
  new Function('performance', 'requestAnimationFrame', 'matchMedia', 'TG',
    'return async ' + grab('glideTo')
  )(global.performance, global.requestAnimationFrame, mm, TG);
const glideTo = makeGlide();

const mkScroller = (height = 10000, client = 500) => ({
  scrollTop: 0, scrollHeight: height, clientHeight: client,
});

(async () => {
  // --- the decisive property: it has landed when it resolves --------------
  const s = mkScroller();
  s.scrollTop = 5000;
  await glideTo(s, 2000, 80);
  assert.strictEqual(s.scrollTop, 2000,
    'scrollTop is exactly the target the moment glideTo resolves');

  // A loop reading immediately after must see a real move.
  const before = s.scrollTop;
  await glideTo(s, before - 400, 80);
  assert.ok(Math.abs(s.scrollTop - before) > 5,
    'the move is observable to the scan loop\'s `moved` check');

  // --- clamping ----------------------------------------------------------
  const c = mkScroller(3000);
  await glideTo(c, -500, 40);
  assert.strictEqual(c.scrollTop, 0, 'clamps at the top, never negative');
  await glideTo(c, 999999, 40);
  assert.strictEqual(c.scrollTop, 3000, 'clamps at scrollHeight');

  // Landing exactly on 0 matters: the loop's top check is `<= 5`.
  const t = mkScroller();
  t.scrollTop = 300;
  await glideTo(t, 0, 60);
  assert.ok(t.scrollTop <= 5, 'reaching the top is detectable');

  // --- no-op cases return without animating ------------------------------
  const n = mkScroller();
  n.scrollTop = 1234;
  await glideTo(n, 1234, 100);
  assert.strictEqual(n.scrollTop, 1234, 'a zero-distance move is a no-op');

  // --- reduced motion jumps instead of animating -------------------------
  const r = mkScroller();
  r.scrollTop = 4000;
  const reducedGlide = makeGlide(() => ({ matches: true }));
  await reducedGlide(r, 100, 500);
  assert.strictEqual(r.scrollTop, 100, 'reduced motion still lands exactly');

  // --- monotonic travel: no overshoot past the target --------------------
  const m = mkScroller();
  m.scrollTop = 0;
  const seen = [];
  const spy = new Proxy(m, {
    set(o, k, v) { if (k === 'scrollTop') seen.push(v); o[k] = v; return true; },
  });
  await glideTo(spy, 1000, 120);
  assert.ok(seen.length > 1, 'the move was animated, not a single jump');
  assert.ok(seen.every(v => v >= 0 && v <= 1000), 'never overshoots the target');
  assert.strictEqual(seen[seen.length - 1], 1000, 'final write is the exact target');

  // --- the scan loop's termination logic still works over a glide --------
  const loop = mkScroller(4000);
  loop.scrollTop = 4000;
  let idle = 0, steps = 0;
  while (idle < 4 && steps < 50) {
    steps++;
    const was = loop.scrollTop;
    await glideTo(loop, was - loop.clientHeight * 0.8, 30);
    const moved = Math.abs(loop.scrollTop - was) > 5;
    if (!moved && loop.scrollTop <= 5) idle++; else idle = 0;
  }
  assert.ok(loop.scrollTop <= 5, 'the loop still walks all the way to the top');
  assert.ok(steps < 50, `and terminates (${steps} steps), rather than spinning`);

  // --- an in-flight glide aborts rather than animating through a stop ----
  const Stopped = class Stopped extends Error {};
  const abortGlide = makeGlide(global.matchMedia, runWith(new Stopped()));
  const a = mkScroller();
  a.scrollTop = 5000;
  await assert.rejects(() => abortGlide(a, 0, 200), e => e instanceof Stopped,
    'a requested stop aborts the glide instead of finishing it');

  // A chat switch during the glide unwinds the same way.
  const Cancelled = class Cancelled extends Error {};
  const cancelGlide = makeGlide(global.matchMedia, runWith(new Cancelled()));
  const b = mkScroller();
  b.scrollTop = 5000;
  await assert.rejects(() => cancelGlide(b, 0, 200), e => e instanceof Cancelled,
    'a chat switch aborts the glide');

  console.log('all 15 scroll checks pass');
})();
