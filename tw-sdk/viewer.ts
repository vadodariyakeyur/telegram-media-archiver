// Driving Telegram's media viewer.
// Viewer markup is far more stable than the message list's, so the real stream
// URL is read from the opened viewer rather than from the bubble.
import { run } from './run';

export const VIEWER_VIDEO = [
  '.media-viewer-whole .media-viewer-movers .media-viewer-aspecter video',  // /k/
  '.MediaViewerContent > .VideoPlayer video',                               // /a/
  '#MediaViewer video',                                                     // /a/ fallback
  '.media-viewer-aspecter video',                                          // /k/ fallback
].join(', ');

export const VIEWER_CLOSE = [
  '.media-viewer-topbar .media-viewer-buttons .btn-icon.tgico-close',       // /k/
  '.media-viewer-close',
  '#MediaViewer button[aria-label="Close" i]',                              // /a/
  '[aria-label="Close" i]',
].join(', ');

export function closeViewer(): void {
  (document.querySelector(VIEWER_CLOSE) as HTMLElement | null)?.click();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, keyCode: 27 } as KeyboardEventInit));
}

export async function openForSrc(bubble: Element, timeoutMs = 20000): Promise<string | null> {
  const target = (bubble.querySelector('video, img, .thumbnail, .media-photo') || bubble) as HTMLElement;
  target.click();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await run().pause(300);
    const v = document.querySelector(VIEWER_VIDEO) as HTMLMediaElement | null;
    const src = v && (v.currentSrc || v.src);
    // A blob: src is the buffer, not a fetchable endpoint.
    if (src && !src.startsWith('blob:')) return src;
    // Some builds only expose the real URL on a <source> child.
    const ssrc = v?.querySelector('source')?.src;
    if (ssrc && !ssrc.startsWith('blob:')) return ssrc;
  }
  return null;
}
