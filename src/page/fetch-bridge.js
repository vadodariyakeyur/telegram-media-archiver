// Runs in the PAGE's JS context (manifest world: MAIN), not the isolated
// content-script world.
//
// Why this file exists: Telegram serves media from /stream/... URLs that are
// handled by its own service worker. A content script's fetch() runs in an
// isolated world, bypasses that service worker, and gets a raw 302 whose
// Location header is not readable — so the download can never be followed.
// Fetching from here goes through the service worker like any page request.
//
// Transport is window.postMessage because the two worlds share no globals.
// Bytes come back as an ArrayBuffer, which structured-clone moves cheaply.

(() => {
  const TAG = 'tg-dl';

  async function fetchRanged(url, id) {
    const parts = [];
    let offset = 0, total = null, mime = 'video/mp4';

    while (total === null || offset < total) {
      const res = await fetch(url, { headers: { Range: `bytes=${offset}-` } });
      if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);

      const cr = res.headers.get('Content-Range');
      if (cr) {
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(cr.trim());
        if (!m) throw new Error('Unparsable Content-Range');
        const [, from, , size] = m;
        // A shifting offset or total means the stream moved under us; bail
        // rather than stitching together mismatched bytes.
        if (+from !== offset) throw new Error('Range offset mismatch');
        if (total !== null && +size !== total) throw new Error('Size changed mid-download');
        total = +size;
      }

      const buf = await res.arrayBuffer();
      const type = res.headers.get('Content-Type');
      if (type && !/octet-stream/.test(type)) mime = type.split(';')[0];
      if (!buf.byteLength) break;

      parts.push(buf);
      offset += buf.byteLength;
      if (total) window.postMessage({ [TAG]: 'progress', id, got: offset, total }, '*');
      if (!cr) break;                    // server ignored Range: single shot
    }

    if (total !== null && offset < total) throw new Error('Incomplete download');

    // Flatten so only one transferable crosses the boundary.
    const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let at = 0;
    for (const p of parts) { out.set(new Uint8Array(p), at); at += p.byteLength; }
    return { buffer: out.buffer, mime };
  }

  window.addEventListener('message', async ev => {
    const msg = ev.data;
    if (ev.source !== window || !msg || msg[TAG] !== 'fetch') return;
    try {
      const { buffer, mime } = await fetchRanged(msg.url, msg.id);
      window.postMessage({ [TAG]: 'done', id: msg.id, buffer, mime }, '*', [buffer]);
    } catch (e) {
      window.postMessage({ [TAG]: 'error', id: msg.id, message: e.message }, '*');
    }
  });
})();
