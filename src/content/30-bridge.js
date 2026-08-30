// Client half of the cross-world fetch bridge.
//
// A <video>'s blob: URL is only the streaming buffer, not the file. The real
// bytes live behind Telegram's /stream/ URLs, which its service worker serves —
// and a content script's fetch() BYPASSES that service worker and gets an
// unfollowable 302. So the fetch is delegated to the page's own context.

const TAG = 'tg-dl';
let msgSeq = 0;

function fetchViaPage(url, onProgress, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const id = ++msgSeq;

    // Declared before either timer so both callbacks can clear the other
    // without reaching into a temporal dead zone.
    let timer = null, watch = null;
    const settle = () => {
      clearInterval(watch); clearTimeout(timer);
      window.removeEventListener('message', onMsg);
    };

    timer = setTimeout(() => { settle(); reject(new Error('timed out')); }, timeoutMs);

    // A video can take minutes and the fetch resolves only on done/error — so
    // without this the run keeps downloading a chat the user already left.
    watch = setInterval(() => {
      const reason = TG.currentRun?.()?.abortReason();
      if (!reason) return;
      settle();
      reject(reason);
    }, 400);

    function onMsg(ev) {
      const m = ev.data;
      if (ev.source !== window || !m || m.id !== id) return;

      if (m[TAG] === 'progress') { onProgress?.(m.got, m.total); return; }

      if (m[TAG] === 'done') {
        settle();
        resolve(new Blob([m.buffer], { type: m.mime || 'video/mp4' }));
      } else if (m[TAG] === 'error') {
        settle();
        reject(new Error(m.message));
      }
    }

    window.addEventListener('message', onMsg);
    window.postMessage({ [TAG]: 'fetch', id, url }, '*');
  });
}

// --- exports ---
TG.fetchViaPage = fetchViaPage;
