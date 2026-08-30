// Deciding what kind of media a message bubble holds.
// Class names churn between Telegram builds, so this leans on structural
// signals (real elements, rendered duration text) wherever it can.

const TYPES = {
  photo:   'Photos',
  video:   'Videos',
  gif:     'GIFs',
  round:   'Video messages',
  sticker: 'Stickers',
  voice:   'Voice notes',
  music:   'Music',
  file:    'Documents',
};

// Kinds whose bytes are not in the page as a blob: they are queued during the
// scan and fetched later by their own pass in 70-collect.js.
const DEFERRED = new Set(['video', 'gif', 'round', 'file']);

// Telegram recycles DOM nodes while scrolling, so object identity is worthless
// for dedupe: a reused node looks like a message already seen, and later videos
// get silently dropped.
function bubbleKey(bubble) {
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

function bubbleOf(el) {
  return el.closest('.message, .Message, .bubble, [data-mid], [data-message-id], [id^="message"]');
}

// A duration badge ("0:42") is the most reliable video/voice marker: rendered
// text, not a class name, so it survives Telegram's markup churn.
function durationIn(bubble) {
  for (const el of bubble.querySelectorAll('span, div, time')) {
    if (el.children.length) continue;                 // leaf nodes only
    const t = (el.textContent || '').trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return t;
  }
  return null;
}

function classify(bubble, img) {
  const has = sel => !!bubble.querySelector(sel);
  const cls = (bubble.className || '') + ' ' +
              [...bubble.querySelectorAll('[class]')].map(e => e.className || '').join(' ');
  const mentions = w => new RegExp(w, 'i').test(typeof cls === 'string' ? cls : '');

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
function docNameIn(bubble) {
  const el = bubble.querySelector(
    '.document-name, .file-name, .document-title, [class*="documentName" i]');
  if (!el) return null;
  const full = el.querySelector('[title]')?.getAttribute('title')
            || el.getAttribute('title');
  const raw = (full || el.textContent || '').trim();
  return raw ? TG.safeName(raw) : null;
}

// Byte size from the rendered "1.35 GB" row. The /stream/ URL will not resolve
// without it: the service worker reads `size` off the params object.
//
// Approximate by construction — the row is rounded to 2 decimals, so this can
// be off by a few MB either way. Telegram serves the true total in
// Content-Range and the bridge follows that, so an over-estimate is corrected
// on the first response; an under-estimate would truncate, hence the round up.
function docSizeIn(bubble) {
  const el = bubble.querySelector('.document-size, .file-size');
  const m = /([\d.,]+)\s*(B|KB|MB|GB|TB)\b/i.exec(el?.textContent || '');
  if (!m) return null;
  const mult = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 }[m[2].toLowerCase()];
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
function docStreamUrl(bubble) {
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
function scrollPosOf(bubble) {
  const sc = TG.findScroller();
  if (!sc) return 0;
  const b = bubble.getBoundingClientRect?.();
  const s = sc.getBoundingClientRect?.();
  if (!b || !s) return sc.scrollTop || 0;
  return (sc.scrollTop || 0) + (b.top - s.top);
}

// Queue a bubble whose bytes cannot be read now. Idempotent: a re-harvest
// re-points the entry at the live node rather than adding a duplicate.
function defer(pending, bubble, kind, extra) {
  if (!pending) return;
  const key = bubbleKey(bubble);
  const seen = pending.find(p => p.key === key);
  if (seen) { seen.bubble = bubble; seen.at = scrollPosOf(bubble); return; }
  pending.push({ key, bubble, kind, at: scrollPosOf(bubble), ...extra });
}

function harvest(found, pending) {
  const grabs = [];
  document.querySelectorAll('img').forEach(img => {
    const src = img.currentSrc || img.src;
    if (!src || !/^(blob:|data:image)/.test(src)) return;
    if (img.naturalWidth && img.naturalWidth < 100) return;   // avatars, icons
    const bubble = bubbleOf(img);
    if (!bubble) return;

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
      const rec = { url: src, kind };
      found.set(src, rec);
      grabs.push(fetch(src)
        .then(r => r.ok ? r.blob() : null)
        .then(b => { if (b?.size) rec.blob = b; })
        .catch(() => {}));           // dead already; the archive step counts it
    }
  });

  document.querySelectorAll('video, audio').forEach(v => {
    const src = v.currentSrc || v.src || v.querySelector('source')?.src;
    if (!src || !/^blob:/.test(src)) return;
    const bubble = bubbleOf(v);
    if (!bubble) return;
    // Classify rather than mapping the tag name: an <audio> is a voice note or
    // a music track, and a <video> may be a gif or a round message.
    const kind = classify(bubble, null) || (v.tagName === 'AUDIO' ? 'voice' : 'video');
    if (DEFERRED.has(kind)) { defer(pending, bubble, kind); return; }
    if (!found.has(src)) found.set(src, { url: src, kind });
  });

  // Documents render as a filename row with no <img>, <video> or <audio>, so
  // the sweeps above cannot reach them — enumerate the rows themselves.
  document.querySelectorAll('.document, .file-name, .document-name, [class*="File" i] a[download]')
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

// --- exports ---
TG.TYPES = TYPES;
TG.DEFERRED = DEFERRED;
TG.bubbleKey = bubbleKey;
TG.harvest = harvest;
TG.docStreamUrl = docStreamUrl;
