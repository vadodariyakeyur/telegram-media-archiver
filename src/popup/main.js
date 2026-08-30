import { els } from './ui/dom.js';
import { log, setState, resetLog } from './ui/log.js';
import { activeTab } from './ui/tabs.js';
import { selected, renderTypes, goCancels } from './ui/manifest.js';
import { render, markStopAsked } from './ui/render.js';
import { setPage } from './ui/hint.js';
import { applyTheme } from './ui/theme.js';

(async () => {
  const tab = await activeTab();
  if (!tab) {
    applyTheme(null);
    setPage({ reachable: false });
    setState('No chat', 'fail');
    els.scan.disabled = true;
    return;
  }

  // Borrow the client's theme before anything renders, so the panel never
  // flashes its default palette first. A failure is not fatal — applyTheme(null)
  // leaves the shipped colours in place.
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_THEME' });
    applyTheme(res?.theme || null);
  } catch { applyTheme(null); }

  // A throw here means no content script answered — the tab is not Telegram,
  // or it needs a reload after the extension was updated.
  try {
    render(await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATE' }));
  } catch {
    setPage({ reachable: false });
    setState('No chat', 'fail');
    els.scan.disabled = true;
  }
})();

async function send(payload, busyText, busyState) {
  markStopAsked(false);
  const tab = await activeTab();
  if (!tab) {
    setState('No chat', 'fail');
    log('Open web.telegram.org and select a chat', 'err');
    return;
  }
  setState(busyState, 'busy');
  log(busyText, 'live');
  try {
    const res = await chrome.tabs.sendMessage(tab.id, payload);
    if (res?.error) { setState('Failed', 'fail'); log(res.error, 'err'); }
  } catch {
    setState('Failed', 'fail');
    log('Cannot reach the page — reload the Telegram tab', 'err');
  }
}

els.scan.onclick = () => {
  renderTypes(null);
  resetLog();
  send({ type: 'SCAN' }, 'Scanning chat', 'Scanning');
};

els.go.onclick = () => {
  // Doubles as the download's cancel button (see setGoCancels in ui/manifest.js).
  if (goCancels()) { requestStop(); return; }
  const kinds = selected();
  send({ type: 'DOWNLOAD', kinds },
       `Downloading ${kinds.join(', ')}`, 'Downloading');
};

els.more.onclick = () => {
  // Continue keeps the existing manifest and log: this is one scan resuming,
  // not a new one.
  els.more.hidden = true;
  send({ type: 'CONTINUE' }, 'Continuing scan', 'Scanning');
};

// Deliberately NOT send(): that helper rewrites the run state, which would
// clobber the live progress line the user is watching. A stop only asks — the
// run reports its own end via STOPPED.
async function requestStop() {
  markStopAsked();
  // Whichever button was pressed is the one to acknowledge on; the other is
  // hidden for this phase (see setBusy in ui/render.js).
  const btn = goCancels() ? els.go : els.stop;
  btn.disabled = true;
  btn.textContent = 'Stopping…';
  log('Stop requested — finishing the current step', 'live');

  const tab = await activeTab();
  if (!tab) return;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'STOP' });
    if (res?.error) log(res.error, 'err');
  } catch {
    log('Cannot reach the page — reload the Telegram tab', 'err');
  }
}

els.stop.onclick = requestStop;

chrome.runtime.onMessage.addListener(render);
