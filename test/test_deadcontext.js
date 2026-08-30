// Reloading the extension while a Telegram tab stays open leaves this content
// script running against a dead chrome.runtime. sendMessage then THROWS
// SYNCHRONOUSLY rather than returning a rejected promise, so the old
// `.catch(() => {})` never saw it: one dead context unwound whatever run was
// in flight, once per progress tick, and surfaced in chrome://extensions as an
// error at 99-main.js's last line.
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const files = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'))
  .content_scripts[1].js.filter(f => !f.includes('vendor'));

// Load the real content scripts the way Chrome does: one shared scope, in
// manifest order, with sendMessage under our control.
function boot(sendMessage, { orphaned = false } = {}) {
  const listeners = {};
  // An orphaned tab (extension reloaded while the tab stayed open) keeps the
  // `chrome` object but loses `runtime` entirely — reading through it is what
  // produced "Cannot read properties of undefined (reading 'sendMessage')".
  const runtime = orphaned ? undefined
    : { id: 'abc123', onMessage: { addListener: fn => { listeners.msg = fn; } }, sendMessage };
  const ctx = {
    console, JSZip: function () {},
    location: { hash: '#-100200300' },
    document: { querySelector: () => null, documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    chrome: { runtime },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return {
    ctx,
    push: m => vm.runInContext('push', ctx)(m),
    state: () => vm.runInContext('state', ctx),
    fire: t => (listeners[t] || []).forEach(fn => fn()),
  };
}

const DEAD = () => { throw new Error('Extension context invalidated.'); };

// --- a dead context must not propagate ------------------------------------
let env = boot(DEAD);
assert.doesNotThrow(() => env.push({ type: 'PROGRESS', done: 1 }),
  'push swallows a synchronous context-invalidated throw');
assert.strictEqual(env.state().type, 'PROGRESS',
  'state is still recorded locally, so a reopened popup is not blank');

// The hashchange handler sends too, and fires without any run in flight.
env.ctx.location.hash = '#-999888777';
assert.doesNotThrow(() => env.fire('hashchange'),
  'hashchange survives a dead context');

// --- a live context still delivers ----------------------------------------
const sent = [];
env = boot(m => { sent.push(m); return Promise.resolve(); });
env.push({ type: 'DONE', total: 3 });
assert.strictEqual(sent.length, 1, 'a live context receives the message');
assert.strictEqual(sent[0].type, 'DONE', 'and receives it intact');

// --- a closed popup rejects; that must stay swallowed ----------------------
env = boot(() => Promise.reject(new Error('Receiving end does not exist.')));
assert.doesNotThrow(() => env.push({ type: 'DONE' }),
  'a rejected promise (popup simply closed) is still swallowed');

// --- the guard is real, not incidental ------------------------------------
// If someone drops the try/catch back to a bare .catch(), this must fail.
const src = fs.readFileSync(path.join(ROOT, 'src/content/99-main.js'), 'utf8');
assert.ok(/try\s*{[^}]*chrome\.runtime\.sendMessage/.test(src),
  'sendMessage is wrapped in try/catch, not only .catch()');
assert.ok(!/^\s*(const push|.*if \(invalidateIfChatChanged\(\)\)) .*chrome\.runtime\.sendMessage/m.test(src),
  'no call site bypasses the guarded send()');

// --- an orphaned tab: chrome.runtime is gone entirely ---------------------
// This is the reported crash. Loading must not throw, because the throw
// happened at the top-level addListener before any listener existed.
let orphan;
assert.doesNotThrow(() => { orphan = boot(undefined, { orphaned: true }); },
  'the content script loads in an orphaned tab instead of throwing at registration');
assert.doesNotThrow(() => orphan.push({ type: 'PROGRESS', done: 1 }),
  'and a push in an orphaned tab is a no-op, not a crash');
assert.doesNotThrow(() => orphan.fire('hashchange'),
  'and so is a chat switch');

// The guard must be load-time, not just inside send().
const src2 = fs.readFileSync(path.join(ROOT, 'src/content/99-main.js'), 'utf8');
assert.ok(!/^chrome\.runtime\.onMessage\.addListener/m.test(src2),
  'the listener registration is guarded, not bare at top level');

console.log('ok  12 checks — dead extension context');
