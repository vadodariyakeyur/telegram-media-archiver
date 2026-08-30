// Driving Telegram's media viewer.
// Viewer markup is far more stable than the message list's, so the real
// stream URL is read from the opened viewer rather than from the bubble.

const VIEWER_VIDEO = [
  '.media-viewer-whole .media-viewer-movers .media-viewer-aspecter video',  // /k/
  '.MediaViewerContent > .VideoPlayer video',                               // /a/
  '#MediaViewer video',                                                     // /a/ fallback
  '.media-viewer-aspecter video',                                           // /k/ fallback
].join(', ');

const VIEWER_CLOSE = [
  '.media-viewer-topbar .media-viewer-buttons .btn-icon.tgico-close',       // /k/
  '.media-viewer-close',
  '#MediaViewer button[aria-label="Close" i]',                              // /a/
  '[aria-label="Close" i]',
].join(', ');

function closeViewer() {
  document.querySelector(VIEWER_CLOSE)?.click();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, keyCode: 27 }));
}

// Open one video message and return the streaming URL the viewer exposes.
async function openForSrc(bubble, timeoutMs = 20000) {
  const target = bubble.querySelector('video, img, .thumbnail, .media-photo') || bubble;
  target.click();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await TG.run().pause(300);
    const v = document.querySelector(VIEWER_VIDEO);
    const src = v && (v.currentSrc || v.src);
    // Ignore a blob: src — that is the buffer, not a fetchable endpoint.
    if (src && !src.startsWith('blob:')) return src;
    // Some builds only expose the real URL on a <source> child.
    const ssrc = v?.querySelector('source')?.src;
    if (ssrc && !ssrc.startsWith('blob:')) return ssrc;
  }
  return null;
}

// Scroll the whole chat and inventory what is there. No fetching, no clicking:
// this is the cheap pass that fills the type list in the popup.

// --- exports ---
TG.VIEWER_VIDEO = VIEWER_VIDEO;
TG.VIEWER_CLOSE = VIEWER_CLOSE;
TG.closeViewer = closeViewer;
TG.openForSrc = openForSrc;
