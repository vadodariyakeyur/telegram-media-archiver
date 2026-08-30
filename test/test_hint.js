// The panel's instruction box must track the PAGE, not just the run: a chat
// that is not open makes every run instruction moot, and the Scan button must
// never invite a click that cannot work. It must also never let a chat name —
// which anyone can set — reach the panel as markup.
const assert = require('assert');

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');

// Minimal DOM: enough for replaceChildren and the one innerHTML parse.
function makeEl() {
  const el = {
    children: [], textContent: '', innerHTML: '', hidden: false, disabled: false,
    className: '',
    replaceChildren(...kids) { this.children = kids; },
    append(...kids) { this.children.push(...kids); },
    get childNodes() { return this.children; },
  };
  return el;
}

// Rendered text, children included — the name lives in its own node so it can
// be coloured, and an assertion on the parent's textContent alone would miss it.
const text = el =>
  typeof el === 'string' ? el
    : (el.textContent || '') + (el.children || []).map(text).join('');

const load = () => {
  const scan = makeEl(), hint = makeEl();
  // innerHTML is only ever fed literals from hint.js, so a parser that records
  // the string is enough to assert the chat name never reaches it.
  const document = {
    createElement: () => makeEl(),
  };
  const src = read('src/popup/ui/hint.js')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export /gm, '');
  const api = new Function('document', 'els',
    src + '\nreturn { setPage, setPhase, key, paint };')(document, { scan, hint });
  return { ...api, scan, hint };
};

// --- the page decides the instruction, and it outranks the run --------------
{
  const { setPage, setPhase, key } = load();

  setPage({ open: true, name: 'Design' });
  assert.strictEqual(key(), 'ready', 'an open chat with no run explains the flow');

  setPhase('scanning');
  assert.strictEqual(key(), 'scanning', 'a running scan says what it is doing');

  // The chat closing mid-run outranks the run's own instruction: telling the
  // user to keep the tab in front is useless once there is nothing to scan.
  setPage({ open: false });
  assert.strictEqual(key(), 'nochat', 'no chat outranks a live run phase');

  setPage({ open: true, name: 'Design', reachable: false });
  assert.strictEqual(key(), 'offpage', 'an unreachable tab outranks everything');
}

// --- the Scan button follows the instruction --------------------------------
{
  const { setPage, setPhase, scan } = load();

  setPage({ open: false });
  assert.strictEqual(scan.disabled, true, 'no chat: Scan cannot work, so it is dead');

  setPage({ open: true, name: 'Design' });
  assert.strictEqual(scan.disabled, false, 'opening a chat revives Scan');

  // setBusy greys Scan out for the duration of a run. Telegram repaints its
  // header constantly, so PAGE messages keep arriving — none of them may hand
  // the button back mid-run.
  setPhase('scanning');
  scan.disabled = true;
  setPage({ open: true, name: 'Design' });
  assert.strictEqual(scan.disabled, true, 'a repaint mid-run does not re-enable Scan');

  // But losing the chat mid-run must still disable it.
  setPhase('scanning');
  scan.disabled = false;
  setPage({ open: false });
  assert.strictEqual(scan.disabled, true, 'losing the chat disables Scan even mid-run');
}

// --- a chat name is text, never markup --------------------------------------
{
  const { setPage, hint } = load();
  const evil = '<img src=x onerror=alert(1)>';
  setPage({ open: true, name: evil });

  const head = hint.children[0];
  assert.ok(text(head).includes(evil),
            'the name is shown');
  // Every node the name could land in, not just the one it lands in today.
  const walk = el => [el, ...(el.children || []).flatMap(c => typeof c === 'string' ? [] : walk(c))];
  for (const el of hint.children.flatMap(c => typeof c === 'string' ? [] : walk(c)))
    assert.ok(!(el.innerHTML || '').includes('onerror'),
              'the name never reaches an innerHTML sink');
}

// --- the content script only announces real changes -------------------------
{
  const src = read('src/content/99-main.js');
  assert.ok(/lastPage/.test(src) && /if \(sig === lastPage\) return;/.test(src),
            'repeat page states are suppressed rather than spamming the panel');
  assert.ok(/pageQueued/.test(src),
            'the body observer is coalesced — a scan renders thousands of nodes');
  assert.ok(/lastPage = '';\s*\n\s*announcePage\(\);/.test(src),
            'a reopened panel is re-told the page state, not suppressed as a duplicate');
}

console.log('all hint checks pass');
