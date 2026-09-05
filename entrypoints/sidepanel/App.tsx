import { useEffect, useRef, useState } from 'react';
import { activeTab } from './hooks/useActiveTab';
import { useTheme } from './hooks/useTheme';
import { useRunState } from './hooks/useRunState';
import type { Theme } from '../../tw-sdk/theme';
import { Hint, type HintPage } from './components/Hint';
import { ManifestList } from './components/ManifestList';
import { StatusLog } from './components/StatusLog';

export function App() {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [page, setPage] = useState<HintPage>({ open: false, name: null, reachable: true });
  const [state, dispatch] = useRunState();
  const selectedRef = useRef<string[]>([]);

  useTheme(theme);

  // send() mirrors main.js's send(): fresh tab lookup, log/state on failure to
  // reach the content script, and marks stopAsked clear on every new request.
  async function send(payload: Record<string, unknown>) {
    const tab = await activeTab();
    if (!tab) {
      dispatch({ type: 'UNREACHABLE' });
      return;
    }
    try {
      const res = await chrome.tabs.sendMessage(tab.id!, payload);
      if (res?.error) dispatch({ type: 'ERROR', message: res.error });
    } catch {
      dispatch({ type: 'ERROR', message: 'Cannot reach the page — reload the Telegram tab' });
    }
  }

  useEffect(() => {
    (async () => {
      const tab = await activeTab();
      if (!tab) {
        setPage({ open: false, name: null, reachable: false });
        dispatch({ type: 'UNREACHABLE' });
        return;
      }
      // Borrow the client's theme before anything renders, so the panel never
      // flashes its default palette first. A failure is not fatal — null
      // leaves the shipped colours in place.
      try {
        const res = await chrome.tabs.sendMessage(tab.id!, { type: 'GET_THEME' });
        setTheme(res?.theme || null);
      } catch { setTheme(null); }

      // A throw here means no content script answered — the tab is not
      // Telegram, or it needs a reload after the extension was updated.
      try {
        const msg = await chrome.tabs.sendMessage(tab.id!, { type: 'GET_STATE' });
        route(msg);
      } catch {
        setPage({ open: false, name: null, reachable: false });
        dispatch({ type: 'UNREACHABLE' });
      }
    })();
    // Mount-only: activeTab() is re-queried fresh inside every send(), this
    // effect only performs the initial handshake.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A theme/page push is not run state; routing it here (instead of a reducer
  // early-return) is what keeps a live scan's UI from being reset by a message
  // that merely reports the palette or the chat header.
  function route(msg: Record<string, unknown> | undefined) {
    if (!msg) return;
    if (msg.type === 'THEME') { setTheme((msg.theme as Theme) || null); return; }
    if (msg.type === 'PAGE') {
      setPage({ open: !!msg.open, name: (msg.name as string) || null, reachable: msg.reachable !== false });
      return;
    }
    dispatch(msg as Parameters<typeof dispatch>[0]);
  }

  useEffect(() => {
    const listener = (msg: Record<string, unknown>) => route(msg);
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { document.body.className = state.stateClass; }, [state.stateClass]);

  // Was hint.js's setPage(): `els.scan.disabled = blocked` is only ever
  // written when blocked or idle. A PAGE push arrives constantly (Telegram
  // repaints its header on every typing indicator) and must never re-enable
  // Scan mid-run just because the chat becomes reachable again — but a block
  // always wins immediately, regardless of run state.
  const idle = state.phase === 'idle' || state.phase === 'scanned';
  const blocked = !page.open || !page.reachable;
  const [scanDisabled, setScanDisabled] = useState(true);
  useEffect(() => {
    if (blocked || idle) setScanDisabled(blocked);
  }, [blocked, idle]);

  async function requestStop() {
    dispatch({ type: 'STOP_ASKED' });
    const tab = await activeTab();
    if (!tab) return;
    try {
      const res = await chrome.tabs.sendMessage(tab.id!, { type: 'STOP' });
      if (res?.error) dispatch({ type: 'ERROR', message: res.error });
    } catch {
      dispatch({ type: 'ERROR', message: 'Cannot reach the page — reload the Telegram tab' });
    }
  }

  const goCount = selectedRef.current.length;
  const goLabel = state.goLabel ?? (goCount ? `Download selected (${goCount})` : 'Download selected');

  return (
    <>
      <header>
        <h1>Telegram Media Archiver</h1>
        <div className="sub"><span className="lamp" />{' '}<span id="state">{state.stateLabel}</span></div>
      </header>
      <main>
        <button
          id="scan"
          hidden={state.busy && !state.stopHidden}
          disabled={scanDisabled}
          onClick={() => { dispatch({ type: 'SCAN_STARTED' }); send({ type: 'SCAN' }); }}
        >
          Scan
        </button>
        <button
          id="stop"
          hidden={state.stopHidden}
          disabled={state.stopDisabled}
          onClick={requestStop}
        >
          {state.stopLabel}
        </button>
        <button
          id="more"
          hidden={!state.resumable}
          onClick={() => { dispatch({ type: 'CONTINUE_STARTED' }); send({ type: 'CONTINUE' }); }}
        >
          Continue scanning
        </button>

        <ManifestList
          types={state.types}
          partial={state.partial}
          onSelectionChange={kinds => { selectedRef.current = kinds; }}
        />

        <Hint page={page} phase={state.phase} />

        <button
          id="go"
          hidden={state.phase !== 'scanned' && !state.goCancels}
          disabled={state.goCancels ? state.goDisabled : (state.goDisabled || goCount === 0)}
          onClick={() => {
            if (state.goCancels) { requestStop(); return; }
            const kinds = selectedRef.current;
            send({ type: 'DOWNLOAD', kinds });
          }}
        >
          {goLabel}
        </button>

        <StatusLog lines={state.lines} />
      </main>
      <footer>Made with ❤️ by vK</footer>
    </>
  );
}
