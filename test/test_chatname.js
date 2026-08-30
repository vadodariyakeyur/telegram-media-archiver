// The zip was being named after the FIRST chat in the sidebar list, because
// `.peer-title` appears on every sidebar row and querySelector returns the
// first document-order match. These checks pin the header-scoped lookup.
const assert = require('assert');
const { JSDOM } = (() => { try { return require('jsdom'); } catch { return {}; } })();
if (!JSDOM) { console.log('skip: jsdom not installed'); process.exit(0); }

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');
const src = read('src/content/10-dom.js');
const grab = n => { const i = src.indexOf(`function ${n}(`); return src.slice(i, src.indexOf('\n}\n', i) + 2); };

let dom;
const load = html => {
  dom = new JSDOM(html);
  global.document = dom.window.document;
// Modules reference siblings via the TG namespace; the eval'd copies
// are bare functions, so point TG at the same global scope.
global.TG = global;
};
eval(grab('chatName') + grab('safeName'));

// The exact reported bug: sidebar list above, open chat in the header.
load(`
  <div id="column-left">
    <ul>
      <li><span class="peer-title">Alice Sidebar</span></li>
      <li><span class="peer-title">Bob Sidebar</span></li>
    </ul>
  </div>
  <div id="column-center">
    <div class="chat-info"><span class="peer-title">Real Open Chat</span></div>
  </div>`);
assert.strictEqual(chatName(), 'Real Open Chat', 'header wins over sidebar');

// /a/ client markup.
load(`
  <div id="LeftColumn"><span class="peer-title">Sidebar First</span></div>
  <div id="MiddleColumn"><div class="ChatInfo"><h3>Webz Chat</h3></div></div>`);
assert.strictEqual(chatName(), 'Webz Chat', '/a/ header used');

// No header at all: fall back to the tab title, minus its unread badge.
load('<div id="column-left"><span class="peer-title">Sidebar Only</span></div>');
dom.window.document.title = '(12) Fallback Chat';
assert.strictEqual(chatName(), 'Fallback Chat', 'tab title fallback, badge stripped');

// A generic tab title must not become the filename.
load('<div></div>');
dom.window.document.title = 'Telegram';
assert.strictEqual(chatName(), 'telegram-chat', 'generic title rejected');

// Filename safety.
assert.strictEqual(safeName('a/b:c*d?e"f<g>h|i'), 'abcdefghi', 'path separators stripped');
assert.strictEqual(safeName('  spaced   out  '), 'spaced out', 'whitespace collapsed');
assert.strictEqual(safeName(''), 'telegram-chat', 'empty falls back');
assert.strictEqual(safeName('///'), 'telegram-chat', 'all-illegal falls back');
assert.strictEqual(safeName('Ольга Петрова'), 'Ольга Петрова', 'unicode preserved');
assert.strictEqual(safeName('日本語チャット'), '日本語チャット', 'CJK preserved');
assert.ok(safeName('x'.repeat(200)).length <= 60, 'length capped');

console.log('all 12 chat-name checks pass');
