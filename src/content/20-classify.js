// Deciding what kind of media a message bubble holds.
// Class names churn between Telegram builds, so this leans on structural
// signals (real elements, rendered duration text) wherever it can.

const TYPES = {
  photo:   'Photos',
  video:   'Videos',
  sticker: 'Stickers',
  voice:   'Voice / audio',
  file:    'Documents',
};

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

  // Real elements beat any class-name heuristic.
  if (has('audio')) return 'voice';
  if (mentions('voice|audio-message|waveform')) return 'voice';

  // Documents: a filename/size row with no thumbnail.
  if (!img && (has('a[download], .document, .file-name') || mentions('document|file-name')))
    return 'file';

  // Stickers are images but never carry a duration.
  if (mentions('sticker')) return 'sticker';

  // Voice already returned above, so a duration badge here means video.
  if (img && durationIn(bubble)) return 'video';

  // Kept narrow to avoid matching generic wrappers.
  if (has('video') || mentions('\\bvideo\\b|media-video|video-time|is-round|gif|animation'))
    return 'video';

  return img ? 'photo' : null;
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

// Sweeps rendered messages into `found`/`pending` and STARTS still-image
// fetches without awaiting them: slots are claimed synchronously, so the caller
// reports accurate counts immediately and settles the bytes afterwards.
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

    // Video and gif posters are not the media itself — queue the bubble.
    if (kind === 'video') {
      if (pending) {
        const key = bubbleKey(bubble);
        const seen = pending.find(p => p.key === key);
        // Re-point at the live node: the old one may have been recycled away.
        if (seen) { seen.bubble = bubble; seen.at = scrollPosOf(bubble); }
        else pending.push({ key, bubble, kind, at: scrollPosOf(bubble) });
      }
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
    const kind = v.tagName === 'AUDIO' ? 'voice' : 'video';
    if (!found.has(src)) found.set(src, { url: src, kind });
  });

  // The caller MUST settle these before the next scroll revokes the blob URLs,
  // but only after it has reported progress.
  return grabs;
}

// --- exports ---
TG.TYPES = TYPES;
TG.bubbleKey = bubbleKey;
TG.harvest = harvest;
