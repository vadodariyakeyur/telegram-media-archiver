import { els } from './ui/dom.js';
import { log, setState, resetLog } from './ui/log.js';
import { activeTab } from './ui/tabs.js';
import { selected, renderTypes } from './ui/manifest.js';
import { render } from './ui/render.js';
import { applyTheme } from './ui/theme.js';

(async () => {
  const tab = await activeTab();
  if (!tab) {
    applyTheme(null);
    setState('No chat', 'fail');
    log('Open web.telegram.org and select a chat', 'err');
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
  resetLog();
  send({ type: 'SCAN' }, 'Scanning chat', 'Scanning');
};

els.go.onclick = () => {
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

els.stop.onclick = async () => {
  // Deliberately NOT send(): that helper rewrites the run state, which would
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
