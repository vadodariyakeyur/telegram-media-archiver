// The manifest updates in place while a scan runs. Rebuilding it each tick
// would discard the user's checkbox selection, so updateCounts() must touch
// only the numbers — and must still add types that first appear mid-scan.
const assert = require('assert');
const { JSDOM } = (() => { try { return require('jsdom'); } catch { return {}; } })();
if (!JSDOM) { console.log('skip: jsdom not installed'); process.exit(0); }

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');

const dom = new JSDOM(`<div id="types" class="empty"></div>
  <button id="go" hidden></button><div id="hint"></div>`);
global.document = dom.window.document;
global.CSS = dom.window.CSS || { escape: s => s };

const els = {
  types: document.getElementById('types'),
  go: document.getElementById('go'),
  hint: document.getElementById('hint'),
};

// Evaluate the module body inside a function so its declarations live in a
// scope of their own, then hand the ones under test back out. Declaring any
// of these names outside would collide with the module's own declarations.
const srcFile = read('src/popup/ui/manifest.js')
  .replace(/^import .*$/m, '')
  .replace(/^export /gm, '');
const { renderTypes, updateCounts, markPartial } =
  new Function('els', 'document', 'CSS',
    srcFile + '\nreturn { renderTypes, updateCounts, markPartial };'
  )(els, global.document, global.CSS);

const rows = () => [...els.types.querySelectorAll('.row')];
const countOf = kind => rows()
  .find(r => r.querySelector('input')?.value === kind)?.querySelector('.n')?.textContent;
const checkedOf = kind => rows()
  .find(r => r.querySelector('input')?.value === kind)?.querySelector('input')?.checked;

// --- first tick builds the list ------------------------------------------
updateCounts([{ kind: 'photo', label: 'Photos', count: 3 }]);
assert.strictEqual(rows().length, 1, 'first tick creates the manifest');
assert.strictEqual(countOf('photo'), '3', 'count rendered');

// --- the user unticks a type ---------------------------------------------
rows()[0].querySelector('input').checked = false;
assert.strictEqual(checkedOf('photo'), false, 'user cleared the box');

// --- a later tick must NOT resurrect that selection -----------------------
updateCounts([{ kind: 'photo', label: 'Photos', count: 17 }]);
assert.strictEqual(countOf('photo'), '17', 'count climbed');
assert.strictEqual(checkedOf('photo'), false,
  'the user\'s selection survives a count update');
assert.strictEqual(rows().length, 1, 'no duplicate row was appended');

// --- a type first seen mid-scan is appended, checked ----------------------
updateCounts([
  { kind: 'photo', label: 'Photos', count: 20 },
  { kind: 'video', label: 'Videos', count: 2 },
]);
assert.strictEqual(rows().length, 2, 'the new type was added');
assert.strictEqual(countOf('video'), '2', 'its count shows');
assert.strictEqual(checkedOf('video'), true, 'new types default to selected');
assert.strictEqual(checkedOf('photo'), false, 'and the old selection still holds');

// --- counts only ever move forward within a pass --------------------------
updateCounts([
  { kind: 'photo', label: 'Photos', count: 41 },
  { kind: 'video', label: 'Videos', count: 9 },
]);
assert.strictEqual(countOf('photo'), '41', 'photo tally updated');
assert.strictEqual(countOf('video'), '9', 'video tally updated');
assert.strictEqual(rows().length, 2, 'still exactly two rows');

// --- an empty tick must not wipe the list ---------------------------------
updateCounts([]);
assert.strictEqual(rows().length, 2, 'an empty update leaves the manifest alone');

// --- a full render resets selection (a NEW scan, not a tick) --------------
renderTypes([{ kind: 'photo', label: 'Photos', count: 1 }]);
assert.strictEqual(checkedOf('photo'), true, 'a fresh render starts all-selected');

console.log('all 14 live-count checks pass');
