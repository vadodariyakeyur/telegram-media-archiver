// The session rules — what may legally follow what — used to be guard clauses
// interleaved with message plumbing in 99-main.js, which exported nothing. The
// only way to reach them was to fake the extension messaging layer, so nobody
// did, and a stale scan surviving a chat switch shipped as a bug twice.
//
// Now they are a plain object, so the rules are asserted directly.
const assert = require('assert');

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');

const TG = {};
eval(read('src/content/90-session.js'));

// A scan result shaped like the real one, with only the fields rules read.
const scanResult = (over = {}) => ({
  found: new Map(Object.entries(over.found || { a: { kind: 'photo' } })),
  pending: over.pending || [],
  counts: over.counts || { photo: 1 },
  stopped: over.stopped || false,
  exhausted: over.exhausted || false,
});

// --- a fresh session refuses everything -----------------------------------
let s = new TG.Session();
assert.strictEqual(s.hasScan, false, 'nothing scanned yet');
assert.strictEqual(s.refuseDownload(['photo']), 'Scan first.',
  'download before any scan is refused, with the reason the user sees');
assert.strictEqual(s.refuseContinue(), 'Nothing to continue.',
  'continue before any scan is refused');
assert.strictEqual(s.canContinue, false, 'and not offered');

// --- a completed scan can be downloaded, not continued --------------------
s = new TG.Session().record(scanResult(), 'peer:aaa');
assert.strictEqual(s.hasScan, true, 'scan recorded');
assert.strictEqual(s.refuseDownload(['photo']), null, 'download is legal');
assert.strictEqual(s.refuseContinue(), 'Nothing to continue.',
  'a completed scan has nothing left to resume');
assert.strictEqual(s.canContinue, false, 'so continue is not offered');
assert.strictEqual(s.isPartial, false, 'and its counts are a total, not a floor');

// --- a stopped scan mid-chat can be continued -----------------------------
s = new TG.Session().record(scanResult({ stopped: true }), 'peer:aaa');
assert.strictEqual(s.refuseContinue(), null, 'continue is legal');
assert.strictEqual(s.canContinue, true, 'and offered');
assert.strictEqual(s.isPartial, true, 'its counts are a floor');
assert.strictEqual(s.refuseDownload(['photo']), null,
  'a partial scan is still downloadable — using it is the point of stopping');

// --- a stopped scan that reached the top has nothing left -----------------
s = new TG.Session().record(scanResult({ stopped: true, exhausted: true }), 'peer:aaa');
assert.strictEqual(s.refuseContinue(), 'Already at the top of the chat.',
  'continuing past the top is refused');
assert.strictEqual(s.canContinue, false, 'so the button is not offered');
assert.strictEqual(s.isPartial, true, 'but the counts are still a floor');

// --- selecting nothing is refused before anything else --------------------
s = new TG.Session().record(scanResult(), 'peer:aaa');
assert.strictEqual(s.refuseDownload([]), 'Nothing selected.', 'empty selection refused');
assert.strictEqual(s.refuseDownload(null), 'Nothing selected.', 'missing selection refused');

// --- THE regression: a scan must not survive a chat switch ----------------
s = new TG.Session().record(scanResult(), 'peer:aaa');
assert.strictEqual(s.invalidateIfChatChanged('peer:aaa'), false,
  'the same chat keeps its scan');
assert.strictEqual(s.hasScan, true, 'and the scan survives');

assert.strictEqual(s.invalidateIfChatChanged('peer:bbb'), true,
  'a switch is detected');
assert.strictEqual(s.hasScan, false,
  'and the stale scan is dropped, not left for DOWNLOAD to act on');
assert.strictEqual(s.refuseDownload(['photo']), 'Scan first.',
  'so a download after a switch is refused');

// A session with no scan must not report a switch — there is nothing to lose.
s = new TG.Session();
assert.strictEqual(s.invalidateIfChatChanged('peer:zzz'), false,
  'no scan means nothing to invalidate');

// Switching away and back must NOT resurrect the scan: the captured DOM nodes
// are gone either way.
s = new TG.Session().record(scanResult(), 'peer:aaa');
s.invalidateIfChatChanged('peer:bbb');
assert.strictEqual(s.invalidateIfChatChanged('peer:aaa'), false,
  'returning finds nothing to invalidate');
assert.strictEqual(s.hasScan, false, 'the old scan stays gone');

// --- itemsFor filters by the selected kinds -------------------------------
s = new TG.Session().record(scanResult({
  found: { a: { kind: 'photo' }, b: { kind: 'video' }, c: { kind: 'photo' } },
}), 'peer:aaa');
assert.strictEqual(s.itemsFor(['photo']).length, 2, 'only the selected kind');
assert.strictEqual(s.itemsFor(['photo', 'video']).length, 3, 'both kinds');
assert.strictEqual(s.itemsFor([]).length, 0, 'nothing selected yields nothing');
assert.strictEqual(new TG.Session().itemsFor(['photo']).length, 0,
  'no scan yields nothing rather than throwing');

// --- clear() forgets everything -------------------------------------------
s = new TG.Session().record(scanResult({ stopped: true }), 'peer:aaa');
s.clear();
assert.strictEqual(s.hasScan, false, 'scan gone');
assert.strictEqual(s.canContinue, false, 'continue no longer offered');
assert.strictEqual(s.invalidateIfChatChanged('peer:qqq'), false,
  'and a later switch has nothing to report');

console.log('all 27 session checks pass');
