// Node recycling is what silently dropped 14 of 24 videos: Telegram reuses the
// same DOM object for different messages, so object-identity dedupe rejected
// later videos as "already seen". These checks pin the key-based behaviour.
const assert = require('assert');
const { JSDOM } = (() => { try { return require('jsdom'); } catch { return {}; } })();
if (!JSDOM) { console.log('skip: jsdom not installed'); process.exit(0); }

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');
const src = read('src/content/20-classify.js');
const grab = n => {
  const i = src.indexOf(`function ${n}(`);
  return src.slice(i, src.indexOf('\n}\n', i) + 2);
};
const dom = new JSDOM('<body></body>');
global.document = dom.window.document;
// Modules reference siblings via the TG namespace; the eval'd copies
// are bare functions, so point TG at the same global scope.
global.TG = global;
global.CSS = { escape: s => s };
eval(grab('durationIn') + grab('bubbleKey'));

const mk = (attrs, html = '') => {
  const d = dom.window.document.createElement('div');
  d.className = 'bubble';
  for (const [k, v] of Object.entries(attrs)) d.setAttribute(k, v);
  d.innerHTML = html;
  dom.window.document.body.appendChild(d);
  return d;
};

// Distinct messages must produce distinct keys.
const a = mk({ 'data-mid': '101' });
const b = mk({ 'data-mid': '102' });
assert.notStrictEqual(bubbleKey(a), bubbleKey(b), 'different mids differ');

// The regression itself: one recycled DOM object reused for two messages.
const recycled = mk({ 'data-mid': '201' });
const k1 = bubbleKey(recycled);
recycled.setAttribute('data-mid', '202');          // Telegram reuses the node
const k2 = bubbleKey(recycled);
assert.notStrictEqual(k1, k2, 'recycled node yields a new key');

// Same message re-rendered as a different object must keep one key.
const first = mk({ 'data-mid': '301' });
const again = mk({ 'data-mid': '301' });
assert.strictEqual(bubbleKey(first), bubbleKey(again), 'same mid is stable across nodes');

// Alternative id attributes are honoured.
assert.ok(bubbleKey(mk({ 'data-message-id': '77' })).startsWith('id:'), 'data-message-id used');
assert.ok(bubbleKey(mk({ id: 'message-88' })).startsWith('id:'), 'element id used');

// With no id at all, the fingerprint must still separate different videos.
const f1 = mk({}, '<span>0:42</span>');
const f2 = mk({}, '<span>1:15</span>');
assert.ok(bubbleKey(f1).startsWith('fp:'), 'falls back to fingerprint');
assert.notStrictEqual(bubbleKey(f1), bubbleKey(f2), 'different durations differ');

// Simulate the scan loop: 24 videos, half delivered on recycled nodes.
const pending = [];
const push = bubble => {
  const key = bubbleKey(bubble);
  const seen = pending.find(p => p.key === key);
  if (seen) seen.bubble = bubble; else pending.push({ key, bubble });
};
const pool = [mk({ 'data-mid': 'x' }), mk({ 'data-mid': 'y' })];   // 2 reused nodes
for (let i = 1; i <= 24; i++) {
  const node = pool[i % 2];                    // Telegram hands back a reused node
  node.setAttribute('data-mid', String(1000 + i));
  push(node);
}
assert.strictEqual(pending.length, 24, `all 24 queued, got ${pending.length}`);

console.log('all 8 dedupe checks pass');
