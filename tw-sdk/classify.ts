// Deciding what kind of media a message bubble holds.
// Class names churn between Telegram builds, so this leans on structural
// signals (real elements, rendered duration text) wherever it can.
import { findScroller } from './dom';
import { safeName } from './dom';
import type { FoundItem, MediaKind, PendingItem } from './types';

export const TYPES: Record<MediaKind, string> = {
  photo: 'Photos',
  video: 'Videos',
  gif: 'GIFs',
  round: 'Video messages',
  sticker: 'Stickers',
  voice: 'Voice notes',
  music: 'Music',
  file: 'Documents',
};

// Kinds whose bytes are not in the page as a blob: they are queued during the
// scan and fetched later by their own pass in collect.ts.
export const DEFERRED: Set<MediaKind> = new Set<MediaKind>(['video', 'gif', 'round', 'file']);

// Telegram recycles DOM nodes while scrolling, so object identity is worthless
// for dedupe: a reused node looks like a message already seen, and later videos
// get silently dropped.
export function bubbleKey(bubble: Element): string {
  const id = bubble.getAttribute?.('data-mid')
          || bubble.getAttribute?.('data-message-id')
          || bubble.getAttribute?.('data-peer-id')
          || bubble.id;
  if (id) return `id:${id}`;
  // ponytail: no id attribute on this build — key on a content fingerprint.
  // Collides only if two videos share duration, size and position exactly.
  const dur = durationIn(bubble) || '';
  const box = bubble.getBoundingClientRect?.();
  return `fp:${dur}|${bubble.textContent?.trim().slice(0, 40) || ''}|${Math.round(box?.width || 0)}x${Math.round(box?.height || 0)}`;
}

export function bubbleOf(el: Element): Element | null {
  return el.closest('.message, .Message, .bubble, [data-mid], [data-message-id], [id^="message"]');
}

// A duration badge ("0:42") is the most reliable video/voice marker: rendered
// text, not a class name, so it survives Telegram's markup churn.
function durationIn(bubble: Element): string | null {
  for (const el of Array.from(bubble.querySelectorAll('span, div, time'))) {
    if (el.children.length) continue;                 // leaf nodes only
    const t = (el.textContent || '').trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return t;
  }
  return null;
}

export function classify(bubble: Element, img: Element | null): MediaKind | null {
  const has = (sel: string) => !!bubble.querySelector(sel);
  const cls = (bubble.className || '') + ' ' +
              Array.from(bubble.querySelectorAll('[class]')).map(e => e.className || '').join(' ');
  const mentions = (w: string) => new RegExp(w, 'i').test(typeof cls === 'string' ? cls : '');

  // A waveform is drawn only for a recorded voice note; an uploaded track gets
  // a title/artist row instead. Both are <audio>, so the markup is the only
  // thing that separates them.
  const isAudio = has('audio') || mentions('voice|audio-message|waveform|audio-element');
  if (isAudio) {
    if (mentions('waveform|voice')) return 'voice';
    if (mentions('audio-title|audio-subtitle|media-title|music')) return 'music';
    // ponytail: unmarked <audio> is treated as a voice note, the commoner case
    // in a chat. Split further if music starts landing in voice/.
    return 'voice';
  }

  // Stickers are images but never carry a duration.
  if (mentions('sticker')) return 'sticker';

  // Round video notes announce themselves; check before plain video, which
  // would otherwise swallow them.
  if (mentions('is-round|round-message|video-note|RoundVideo')) return 'round';

  // Telegram ships GIFs as silent looping MP4s, so the <video> element alone
  // cannot tell them apart — the gif/animation marker is the only signal.
  if (mentions('\\bgif\\b|animation|is-looping')) return 'gif';

  // Voice already returned above, so a duration badge here means video.
  if (img && durationIn(bubble)) return 'video';

  if (has('video') || mentions('\\bvideo\\b|media-video|video-time'))
    return 'video';

  // Before the photo fallback, not after: a document row often renders a
  // thumbnail, and `if (img)` would claim it as a photo and archive the
  // preview instead of the attachment.
  if (has('a[download], .document, .file-name, .document-name')
      || mentions('document|file-name|\\bfile\\b'))
    return 'file';

  if (img) return 'photo';

  return null;
}

// The filename Telegram renders for a document row. Worth keeping: a zip full
// of file_0001.bin is not an archive of anything.
//
// The `title` attribute holds the FULL name; the element's text is
// middle-ellipsised for display ("[@Anime_RTX] [S…RIP] [Sub].mkv"), so reading
// textContent puts a literal ellipsis in the archive.
export function docNameIn(bubble: Element): string | null {
  const el = bubble.querySelector(
    '.document-name, .file-name, .document-title, [class*="documentName" i]');
  if (!el) return null;
  const full = el.querySelector('[title]')?.getAttribute('title')
            || el.getAttribute('title');
  const raw = (full || el.textContent || '').trim();
  return raw ? safeName(raw) : null;
}

// Byte size from the rendered "1.35 GB" row. The /stream/ URL will not resolve
// without it: the service worker reads `size` off the params object.
//
// Approximate by construction — the row is rounded to 2 decimals, so this can
// be off by a few MB either way. Telegram serves the true total in
// Content-Range and the bridge follows that, so an over-estimate is corrected
// on the first response; an under-estimate would truncate, hence the round up.
export function docSizeIn(bubble: Element): number | null {
  const el = bubble.querySelector('.document-size, .file-size');
  const m = /([\d.,]+)\s*(B|KB|MB|GB|TB)\b/i.exec(el?.textContent || '');
  if (!m) return null;
  const mult = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 }[m[2].toLowerCase() as 'b' | 'kb' | 'mb' | 'gb' | 'tb'];
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? Math.ceil(n * mult) : null;
}

// Telegram's service worker serves the real bytes from /stream/<json>, where the
// json is RAW (URI-encoded), NOT base64 — it is JSON.parse'd straight off the
// path. The document id comes from data-doc-id on the row.
//
// `location` MUST be the nested wrapper shape: a bare inputDocumentFileLocation
// crashes the worker in getDocId. `dcId` is ignored (the worker resolves the
// real datacenter itself) but the field must be present. No access_hash or
// file_reference is needed — the worker holds those in its own state.
export function docStreamUrl(bubble: Element): string | null {
  const el = bubble.querySelector('[data-doc-id]');
  const id = el?.getAttribute('data-doc-id');
  const size = docSizeIn(bubble);
  if (!id || !size) return null;

  const name = docNameIn(bubble) || 'file';
  const params = {
    dcId: 2,
    location: { _: 'inputDocumentFileLocation', id },
    size,
    mimeType: 'application/octet-stream',
    fileName: name,
  };
  return `${location.origin}/stream/${encodeURIComponent(JSON.stringify(params))}`;
}

// Roughly where a bubble sits in the scroll container, so the download pass can
// visit videos in list order instead of hunting each one independently.
export function scrollPosOf(bubble: Element): number {
  const sc = findScroller() as (Element & { scrollTop: number }) | null;
  if (!sc) return 0;
  // offsetTop is a cached layout property; getBoundingClientRect() forces a
  // synchronous layout flush. This runs once per deferred video per harvest
  // tick, so the difference is the scroll stuttering or not on a screenful of
  // videos. Falls back to rects only where offsetTop is unavailable.
  const off = (bubble as HTMLElement).offsetTop;
  if (typeof off === 'number' && off > 0) return off;
  const b = bubble.getBoundingClientRect?.();
  const s = sc.getBoundingClientRect?.();
  if (!b || !s) return sc.scrollTop || 0;
  return (sc.scrollTop || 0) + (b.top - s.top);
}

// Queue a bubble whose bytes cannot be read now. Idempotent: a re-harvest
// re-points the entry at the live node rather than adding a duplicate.
//
// The scan re-harvests every ~120ms while a screenful settles, so this runs
// hot. Two things keep it from stalling the page on a video-dense screen,
// where it would otherwise cost O(pending²) forced layouts per tick and make
// the scroll visibly stutter:
//   - the index, so a re-harvest is a lookup rather than a linear scan;
//   - re-measuring `at` only when the node actually changed, since
//     scrollPosOf() calls getBoundingClientRect() and each call flushes layout.
export function defer(pending: PendingItem[], bubble: Element, kind: MediaKind, extra?: Partial<PendingItem> | null): void {
  if (!pending) return;
  const key = bubbleKey(bubble);
  const seen = indexOf(pending).get(key);
  if (seen) {
    if (seen.bubble !== bubble) { seen.bubble = bubble; seen.at = scrollPosOf(bubble); }
    return;
  }
  const item: PendingItem = { key, bubble, kind, at: scrollPosOf(bubble), ...extra };
  pending.push(item);
  indexOf(pending).set(key, item);
}

// Key -> entry, keyed off the array itself so a `pending` carried over from a
// stopped scan picks its index back up. WeakMap: the index dies with the array.
// defer() is the only writer of `pending` anywhere, so once built the index
// cannot drift out of sync with it.
const INDEXES = new WeakMap<PendingItem[], Map<string, PendingItem>>();
function indexOf(pending: PendingItem[]): Map<string, PendingItem> {
  let ix = INDEXES.get(pending);
  if (!ix) { ix = new Map(pending.map(p => [p.key, p])); INDEXES.set(pending, ix); }
  return ix;
}

export function harvest(found: Map<string, FoundItem>, pending: PendingItem[]): Promise<unknown>[] {
  const grabs: Promise<unknown>[] = [];
  // Scoped to the message list, not the document: the sidebar's chat rows are
  // hundreds of avatar <img> nodes that every sweep would otherwise walk and
  // measure, eight times a second, for the whole scan.
  const scope = findScroller() ?? document;

  Array.from(scope.querySelectorAll('img')).forEach(img => {
    const src = img.currentSrc || img.src;
    if (!src || !/^(blob:|data:image)/.test(src)) return;
    // Cheap rejects BEFORE any measurement: a photo already captured, or one
    // whose decoded size already proves it is a photo, needs no layout read.
    if (found.has(src)) return;
    const bubble = bubbleOf(img);
    if (!bubble) return;
    // Size separates a real photo from an avatar or an icon, and it is unknown
    // until the image decodes. offsetWidth is read only for the still-decoding
    // case (naturalWidth 0, but laid out full width) — reading it for every
    // image forces a synchronous layout per image per harvest tick, which on a
    // video-dense screen is hundreds of reflows a second and visibly stalls
    // the scroll.
    const w = img.naturalWidth || (img as HTMLElement).offsetWidth || 0;
    if (w && w < 100) return;

    const kind = classify(bubble, img);
    if (!kind) return;

    // A poster frame or a document's thumbnail is not the media itself.
    if (DEFERRED.has(kind)) {
      defer(pending, bubble, kind, kind === 'file' ? { name: docNameIn(bubble) } : null);
      return;
    }
    if (!found.has(src)) {
      // Claim the slot synchronously so a later pass does not re-fetch it,
      // then pull the bytes before the URL can be revoked.
      const rec: FoundItem = { url: src, kind };
      found.set(src, rec);
      grabs.push(fetch(src)
        .then(r => r.ok ? r.blob() : null)
        .then(b => { if (b?.size) rec.blob = b; })
        .catch(() => {}));           // dead already; the archive step counts it
    }
  });

  Array.from(scope.querySelectorAll('video, audio')).forEach(v => {
    const media = v as HTMLMediaElement;
    const src = media.currentSrc || media.src || media.querySelector('source')?.src;
    if (!src || !/^blob:/.test(src)) return;
    const bubble = bubbleOf(media);
    if (!bubble) return;
    // Classify rather than mapping the tag name: an <audio> is a voice note or
    // a music track, and a <video> may be a gif or a round message.
    const kind = classify(bubble, null) || (media.tagName === 'AUDIO' ? 'voice' : 'video');
    if (DEFERRED.has(kind)) { defer(pending, bubble, kind); return; }
    if (!found.has(src)) found.set(src, { url: src, kind });
  });

  // Documents render as a filename row with no <img>, <video> or <audio>, so
  // the sweeps above cannot reach them — enumerate the rows themselves.
  Array.from(scope.querySelectorAll('.document, .file-name, .document-name, [class*="File" i] a[download]'))
    .forEach(el => {
      const bubble = bubbleOf(el);
      if (!bubble) return;
      if (classify(bubble, bubble.querySelector('img')) !== 'file') return;
      defer(pending, bubble, 'file', { name: docNameIn(bubble) });
    });

  // The caller MUST settle these before the next scroll revokes the blob URLs,
  // but only after it has reported progress.
  return grabs;
}
