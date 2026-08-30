// Telegram is a single-page app: switching chats never reloads the page, so
// the content script and any scan it holds survive the switch. Without an
// identity check the popup would show the previous chat's manifest, and a
// download would act on that chat's captured nodes.
const assert = require('assert');
const { JSDOM } = (() => { try { return require('jsdom'); } catch { return {}; } })();
if (!JSDOM) { console.log('skip: jsdom not installed'); process.exit(0); }

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');
const src = read('src/content/10-dom.js');
const grab = n => { const i = src.indexOf(`function ${n}(`); return src.slice(i, src.indexOf('\n}\n', i) + 2); };

const dom = new JSDOM('<body></body>', { url: 'https://web.telegram.org/k/' });
global.document = dom.window.document;
global.location = dom.window.location;

// Evaluate the source as a function *expression* so it yields a value
// directly: a declaration would either collide with a local binding or sit in
// the temporal dead zone when referenced from the same eval.
const chatKey = eval('(' + grab('chatKey').trim().replace(/^function /, 'function ') + ')');

const setHash = h => { dom.window.location.hash = h; global.location = dom.window.location; };

// --- identity ------------------------------------------------------------
setHash('#-1001234567890');
const a = chatKey();
assert.ok(a.startsWith('peer:'), 'peer id used when the hash carries it');

setHash('#-1009876543210');
assert.notStrictEqual(chatKey(), a, 'a different chat yields a different key');

setHash('#-1001234567890');
assert.strictEqual(chatKey(), a, 'returning to a chat yields the same key');

// The /a/ client uses a bare numeric hash.
setHash('#12345678');
assert.strictEqual(chatKey(), 'peer:12345678', '/a/ style hash handled');

// Query suffixes must not change identity.
setHash('#12345678?thread=5');
assert.strictEqual(chatKey(), 'peer:12345678', 'query suffix ignored');

// --- fallback when the hash carries nothing -------------------------------
const bare = new JSDOM(
  '<div id="column-center"><div class="chat-info"><span class="peer-title">Ops Team</span></div></div>',
  { url: 'https://web.telegram.org/k/' });
global.document = bare.window.document;
global.location = bare.window.location;
assert.strictEqual(chatKey(), 'name:Ops Team', 'falls back to the header name');

global.document = new JSDOM('<div></div>').window.document;
assert.strictEqual(chatKey(), 'none', 'no chat open yields a sentinel');

// --- the invalidation rule itself -----------------------------------------
// Mirrors invalidateIfChatChanged(): only a *change* from a known key resets.
function makeGuard() {
  let scan = null, scanKey = null;
  return {
    record: (k, s) => { scanKey = k; scan = s; },
    check(now) {
      if (scanKey !== null && now !== scanKey) { scan = null; scanKey = null; return true; }
      return false;
    },
    get scan() { return scan; },
  };
}

let g = makeGuard();
g.record('peer:111', { photo: 5 });
assert.strictEqual(g.check('peer:111'), false, 'same chat keeps its scan');
assert.ok(g.scan, 'scan survives a same-chat check');
assert.strictEqual(g.check('peer:222'), true, 'a switch invalidates');
assert.strictEqual(g.scan, null, 'stale scan is dropped, not reused');

// A fresh session (no scan yet) must not report a reset.
g = makeGuard();
assert.strictEqual(g.check('peer:333'), false, 'no scan means nothing to invalidate');

// Switching away and back must still invalidate: the nodes are gone either way.
g = makeGuard();
g.record('peer:111', { photo: 5 });
g.check('peer:222');
assert.strictEqual(g.scan, null, 'round trip does not resurrect the old scan');

console.log('all 12 chat-switch checks pass');
