// Locating Telegram's scrolling message list and naming the open chat.
// Both differ between the /k/ and /a/ clients, so selectors are grouped here
// rather than scattered through the call sites.

function findScroller() {
  const sel = [
    '.messages-layout',           // /a/
    '.bubbles .scrollable',       // /k/
    '.MessageList',               // /a/
    '.bubbles',                   // /k/
  ];
  for (const s of sel) {
    const el = document.querySelector(s);
    if (el) {
      // Walk up to whatever actually scrolls.
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (n.scrollHeight > n.clientHeight + 50) return n;
      }
    }
  }
  return null;
}

// The open chat's name, taken from the chat header.
//
// Every row in the sidebar chat list also carries `.peer-title`, and
// querySelector returns the first match in document order — so an unscoped
// lookup names the zip after the top chat in the list, not the open one.
// Every selector here must be anchored to the header region.
function chatName() {
  const HEADERS = [
    '#column-center .chat-info',            // /k/
    '#column-center .sidebar-header',       // /k/ (some builds)
    '#MiddleColumn .ChatInfo',              // /a/
    '#MiddleColumn .chat-info',             // /a/ fallback
    '.chat-container .chat-info',
    '.MessagesLayout .ChatInfo',
  ];

  for (const h of HEADERS) {
    const head = document.querySelector(h);
    if (!head) continue;
    // Within the header, the first title-ish node is the open chat.
    const el = head.querySelector('.peer-title, .title, .fullName, h3');
    const raw = (el?.textContent || '').trim();
    if (raw) return safeName(raw);
  }

  // Last resort: the tab title, which Telegram sets to the open chat.
  const t = (document.title || '').replace(/^\(\d+\)\s*/, '').trim();
  return safeName(t && t !== 'Telegram' ? t : 'telegram-chat');
}

function safeName(raw) {
  // Strip path separators and anything awkward in a filename; keep unicode
  // letters so non-Latin chat names survive.
  const cleaned = raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '')
                     .replace(/\s+/g, ' ')
                     .trim()
                     .slice(0, 60);
  return cleaned || 'telegram-chat';
}

// A video message renders as a poster <img> with a play overlay until you
// click it — Telegram only creates the <video> and its blob on play. So a
// scroll pass can only *find* videos; loading them needs the click pass below.
const VIDEO_HINT = '[class*="video" i], [class*="Video"], .media-duration, .message-video-duration, .video-time';

// Media types the scan reports. Order drives the popup list.

// A stable identifier for the currently open chat.
//
// Telegram is a single-page app: switching chats never reloads the page, so
// the content script (and any scan it holds) survives the switch. Comparing
// this value is how stale results are detected and discarded.
//
// The URL hash carries the peer id in both clients (#-1001234567890 on /k/,
// #12345678 on /a/), which is stable across renames. The header name is only a
// fallback for builds that do not put the peer in the hash; it is weaker,
// since two chats can share a name.
function chatKey() {
  const hash = (location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
  if (hash) return `peer:${hash}`;

  const head = document.querySelector(
    '#column-center .chat-info, #MiddleColumn .ChatInfo, .chat-container .chat-info');
  const title = head?.querySelector('.peer-title, .title, .fullName, h3')?.textContent?.trim();
  return title ? `name:${title}` : 'none';
}

// Animated scrolling that RESOLVES ONLY WHEN THE MOVE HAS LANDED.
//
// This matters more than the animation itself. The scan loop reads scrollTop
// immediately after moving to decide whether it moved, whether the list grew,
// and whether it reached the top. CSS `scroll-behavior: smooth` would make
// those reads return a mid-animation value, so the loop would mis-detect a
// stall and stop early — silently losing media. Awaiting this instead keeps
// the reads truthful.
//
// Cancellation is honoured: a stop or chat switch during the glide unwinds
// at the caller's next checkpoint rather than finishing the animation.
async function glideTo(scroller, target, ms = 260) {
  const from = scroller.scrollTop;
  const to = Math.max(0, Math.min(target, scroller.scrollHeight));
  const dist = to - from;

  // Nothing to do, or the user prefers reduced motion: jump and return.
  const reduced = matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (!dist || reduced || ms <= 0) {
    scroller.scrollTop = to;
    return;
  }

  const t0 = performance.now();
  // easeOutCubic: quick start, settled finish — reads as deliberate rather
  // than floaty, and spends least time near the destination.
  const ease = t => 1 - Math.pow(1 - t, 3);

  await new Promise((resolve, reject) => {
    const step = now => {
      // Abort mid-glide rather than animating through a stop or a chat
      // switch: without this, every glide is up to `ms` of unabortable work,
      // and in the sweep loops those stack up. An animation frame cannot
      // await, so this reads the reason synchronously.
      const reason = TG.currentRun?.()?.abortReason();
      if (reason) return reject(reason);

      const t = Math.min(1, (now - t0) / ms);
      scroller.scrollTop = from + dist * ease(t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });

  // Land exactly on target: accumulated float error would otherwise leave a
  // sub-pixel offset that the loop's `moved` check could misread.
  scroller.scrollTop = to;
}

// --- exports ---
TG.chatKey = chatKey;
TG.glideTo = glideTo;
TG.findScroller = findScroller;
TG.chatName = chatName;
TG.safeName = safeName;
