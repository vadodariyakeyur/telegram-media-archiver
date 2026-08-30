// Client half of the cross-world fetch bridge.
// Video bytes must be fetched from the PAGE's context (see src/page/), so
// requests are posted across the world boundary and awaited here.

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

    // A video can take minutes, and the fetch resolves only on done/error —
    // so without this the run would keep downloading a chat the user has
    // already left. Poll the chat identity alongside the transfer.
    watch = setInterval(() => {
      // A poll cannot await, so read the reason synchronously.
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

// The message list markup is unstable, but the media viewer is not. Open a
// bubble, read the src off the viewer's <video>, then close it.

// --- exports ---
TG.fetchViaPage = fetchViaPage;
