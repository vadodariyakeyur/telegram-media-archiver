// The instruction box: what to do next, given what the page is showing.
// Page state (which chat is open) and run state (what the archiver is doing)
// arrive from different messages, so both are held here and the more urgent
// one wins — a chat that is not open makes every run instruction moot.
import { els } from './dom.js';

let page = { open: false, name: null, reachable: true };
let phase = 'idle';
const idle = () => phase === 'idle' || phase === 'scanned';

// Kept as data rather than branches of DOM code so the copy for a state is one
// line, and adding a state does not mean adding a render path.
const HINTS = {
  offpage: ['Not on Telegram',
    ['Open <em>web.telegram.org</em> in this tab, then reopen this panel.']],
  nochat: ['No chat open',
    ['Pick a conversation in Telegram. The panel follows whatever is open.']],
  ready: ['What happens',
    ['Scanning scrolls the whole chat and counts what it finds, by type. Nothing downloads yet.',
     'You then pick the types to keep and get one <em>.zip</em>, foldered by type.']],
  scanning: ['Scanning',
    ['Keep this tab in front — Telegram stops rendering messages in a background tab, and the scan reads what is rendered.']],
  scanned: ['Pick what to keep',
    ['Tick the types you want, then Download selected. Only then are the files fetched.']],
  fetching: ['Downloading',
    ['Keep this tab in front. Cancel stops the download and saves nothing — a half archive is not worth the confusion.']],
  zipping: ['Packing',
    ['Building the archive. This step cannot be cancelled: a half-written zip is worse than a slow one.']],
};

function key() {
  if (!page.reachable) return 'offpage';
  if (!page.open) return 'nochat';
  if (phase === 'idle' || phase === 'ready') return 'ready';
  return phase;
}

function paint() {
  const k = key();
  const [title, paras] = HINTS[k] || HINTS.ready;

  const head = document.createElement('b');
  head.textContent = title;
  // A separate node rather than one interpolated string: the name needs its own
  // colour, and textContent on it keeps the escaping that a template would lose
  // — a chat name is attacker-controlled, anyone can name a group
  // `<img src=x onerror=…>` and this panel would run it.
  if (page.name && k !== 'offpage' && k !== 'nochat') {
    const name = document.createElement('span');
    name.className = 'chat';
    name.textContent = page.name;
    head.append(' \u00b7 ', name);
  }

  // innerHTML for the paragraphs is safe ONLY because every one of those
  // strings is a literal in this file; they carry <em> markup by design.
  const body = document.createElement('div');
  body.innerHTML = paras.map(p => `<p>${p}</p>`).join('');

  els.hint.replaceChildren(head, ...body.childNodes);
}

export function setPage(info) {
  page = { open: !!info.open, name: info.name || null, reachable: info.reachable !== false };
  // Saying "open a chat" while the button that needs one is still live invites
  // the click the instruction just warned against.
  //
  // Gated on idle because a PAGE message arrives constantly (Telegram repaints
  // the header on every typing indicator); enabling during a run would hand
  // back a Scan button that setBusy had greyed out for the run in flight.
  const blocked = !page.open || !page.reachable;
  if (blocked || idle()) els.scan.disabled = blocked;
  paint();
}

export function setPhase(next) {
  phase = next;
  paint();
}

paint();
