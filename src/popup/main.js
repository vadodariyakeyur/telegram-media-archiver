// Popup entry point: boots state, wires the buttons, subscribes to the
// content script. Loaded as a module from popup.html.
import { els } from './ui/dom.js';
import { log, setState, resetLog } from './ui/log.js';
import { activeTab } from './ui/tabs.js';
import { selected, renderTypes } from './ui/manifest.js';
import { render } from './ui/render.js';
import { applyTheme } from './ui/theme.js';

(async () => {
  const tab = await activeTab();
  if (!tab) {
    // No Telegram tab: keep the shipped palette rather than a stale borrowed
    // one, then report why nothing can be scanned.
    applyTheme(null);
    setState('No chat', 'fail');
    log('Open web.telegram.org and select a chat', 'err');
    els.scan.disabled = true;
    return;
  }

  // Borrow the open client's theme before anything renders, so the panel
  // never flashes its default palette first. A failure here is not fatal —
  // applyTheme(null) simply leaves the shipped colours in place.
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_THEME' });
    applyTheme(res?.theme || null);
  } catch { applyTheme(null); }

  try { render(await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATE' })); } catch {}
})();

async function send(payload, busyText, busyState) {
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
  resetLog();                        // a fresh scan starts a fresh log
  send({ type: 'SCAN' }, 'Scanning chat', 'Scanning');
};

els.go.onclick = () => {
  const kinds = selected();
  send({ type: 'DOWNLOAD', kinds },
       `Downloading ${kinds.join(', ')}`, 'Downloading');
};

els.more.onclick = () => {
  // Continue keeps the existing manifest and log: this is one scan resuming,
  // not a new one. The content script carries the collected media forward.
  els.more.hidden = true;
  send({ type: 'CONTINUE' }, 'Continuing scan', 'Scanning');
};

els.stop.onclick = async () => {
  // Deliberately not send(): that helper rewrites the run state, which would
  // clobber the live progress line the user is watching. A stop only asks —
  // the run reports its own end via STOPPED.
  els.stop.disabled = true;
  els.stop.textContent = 'Stopping…';
  log('Stop requested — finishing the current step', 'live');

  const tab = await activeTab();
  if (!tab) return;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'STOP' });
    if (res?.error) log(res.error, 'err');
  } catch {
    log('Cannot reach the page — reload the Telegram tab', 'err');
  }
};

chrome.runtime.onMessage.addListener(render);
