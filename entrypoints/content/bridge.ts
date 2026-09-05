// Client half of the cross-world fetch bridge.
//
// A <video>'s blob: URL is only the streaming buffer, not the file. The real
// bytes live behind Telegram's /stream/ URLs, which its service worker serves —
// and a content script's fetch() BYPASSES that service worker and gets an
// unfollowable 302. So the fetch is delegated to the page's own context.
import { currentRun } from '../../tw-sdk/run';

const TAG = 'tg-dl';
let msgSeq = 0;

interface BridgeMessage {
  [TAG]: 'fetch' | 'progress' | 'done' | 'error';
  id: number;
  url?: string;
  got?: number;
  total?: number;
  buffer?: ArrayBuffer;
  mime?: string;
  message?: string;
}

export function fetchViaPage(url: string, onProgress?: (got: number, total: number) => void, timeoutMs = 180000): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = ++msgSeq;

    // Declared before either timer so both callbacks can clear the other
    // without reaching into a temporal dead zone.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watch: ReturnType<typeof setInterval> | null = null;
    const settle = () => {
      if (watch != null) clearInterval(watch);
      if (timer != null) clearTimeout(timer);
      window.removeEventListener('message', onMsg);
    };

    timer = setTimeout(() => { settle(); reject(new Error('timed out')); }, timeoutMs);

    // A video can take minutes and the fetch resolves only on done/error — so
    // without this the run keeps downloading a chat the user already left.
    watch = setInterval(() => {
      const reason = currentRun()?.abortReason();
      if (!reason) return;
      settle();
      reject(reason);
    }, 400);

    function onMsg(ev: MessageEvent) {
      const m = ev.data as BridgeMessage;
      if (ev.source !== window || !m || m.id !== id) return;

      if (m[TAG] === 'progress') { onProgress?.(m.got!, m.total!); return; }

      if (m[TAG] === 'done') {
        settle();
        // No mime default: this pass fetches documents and audio too, and a
        // wrong type here would name every one of them .mp4.
        resolve(new Blob([m.buffer!], m.mime ? { type: m.mime } : undefined));
      } else if (m[TAG] === 'error') {
        settle();
        reject(new Error(m.message));
      }
    }

    window.addEventListener('message', onMsg);
    window.postMessage({ [TAG]: 'fetch', id, url }, '*');
  });
}
