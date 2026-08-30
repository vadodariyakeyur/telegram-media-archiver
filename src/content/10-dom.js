// Locating Telegram's scrolling message list and naming the open chat.
// Selectors differ between the /k/ and /a/ clients.

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
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (n.scrollHeight > n.clientHeight + 50) return n;
      }
    }
  }
  return null;
}

// Every sidebar chat row also carries `.peer-title`, and querySelector returns
// the first match in document order — so an UNSCOPED lookup names the zip after
// the top chat in the list, not the open one. Every selector must be anchored
// to the header region.
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
    const el = head.querySelector('.peer-title, .title, .fullName, h3');
    const raw = (el?.textContent || '').trim();
    if (raw) return safeName(raw);
  }

  const t = (document.title || '').replace(/^\(\d+\)\s*/, '').trim();
  return safeName(t && t !== 'Telegram' ? t : 'telegram-chat');
}

function safeName(raw) {
  // Keep unicode letters so non-Latin chat names survive.
  const cleaned = raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '')
                     .replace(/\s+/g, ' ')
                     .trim()
                     .slice(0, 60);
  return cleaned || 'telegram-chat';
}

// A stable identifier for the open chat. Telegram never reloads the page on a
// chat switch, so comparing this is how stale results are detected.
//
// The URL hash carries the peer id in both clients and is stable across
// renames. The header name is a weaker fallback — two chats can share a name.
function chatKey() {
  const hash = (location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
  if (hash) return `peer:${hash}`;

  const head = document.querySelector(
    '#column-center .chat-info, #MiddleColumn .ChatInfo, .chat-container .chat-info');
  const title = head?.querySelector('.peer-title, .title, .fullName, h3')?.textContent?.trim();
  return title ? `name:${title}` : 'none';
}

// RESOLVES ONLY WHEN THE MOVE HAS LANDED. The scan loop reads scrollTop right
// after moving to decide whether it moved, grew, or reached the top; CSS
// `scroll-behavior: smooth` would make those reads mid-animation, so the loop
// would mis-detect a stall and stop early, silently losing media.
async function glideTo(scroller, target, ms = 260) {
  const from = scroller.scrollTop;
  const to = Math.max(0, Math.min(target, scroller.scrollHeight));
  const dist = to - from;

  const reduced = matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (!dist || reduced || ms <= 0) {
    scroller.scrollTop = to;
    return;
  }

  const t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);

  // Timer-driven, NOT requestAnimationFrame: rAF only fires while the tab is
  // painting, so a backgrounded tab froze the glide and with it the whole scan.
  const FRAME = 16;
  for (;;) {
    // Without this every glide is up to `ms` of unabortable work, and in the
    // sweep loops those stack up.
    const reason = TG.currentRun?.()?.abortReason();
    if (reason) throw reason;

    const t = Math.min(1, (performance.now() - t0) / ms);
    scroller.scrollTop = from + dist * ease(t);
    if (t >= 1) break;
    await TG.sleep(FRAME);
  }

  // Land exactly: accumulated float error would leave a sub-pixel offset the
  // loop's `moved` check could misread.
  scroller.scrollTop = to;
}

// --- exports ---
TG.chatKey = chatKey;
TG.glideTo = glideTo;
TG.findScroller = findScroller;
TG.chatName = chatName;
