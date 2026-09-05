# Telegram Media Archiver

Chrome extension that saves media from the Telegram Web chat you have open,
as a single zip. Scan first to see what's there, then pick which types to save.

## Install

1. `pnpm install`
2. `pnpm build` (or `pnpm dev` for a dev server with hot reload)
3. Go to `chrome://extensions`
4. Turn on **Developer mode** (top right)
5. **Load unpacked** → select `.output/chrome-mv3` (or `.output/chrome-mv3-dev` under `pnpm dev`)

## Use

1. Open `https://web.telegram.org/` and click into the chat you want
2. Click the extension icon → **Scan chat**
   It scrolls the whole chat and lists each media type with a count.
3. Tick the types you want → **Download selected**
4. Leave the tab in the foreground until the zip is saved

Files land in the zip under one folder per type (`photo/`, `video/`, …).
Documents keep their original filename, with a sequence number appended so two
files sharing a name cannot overwrite each other.

Works on private chats: it reads media the Telegram app has already loaded and
decrypted in your own authenticated session. It does not touch MTProto, keys,
or anyone else's account.

## How it works

Photos, stickers and other still media are decrypted by Telegram into `blob:`
URLs in the page. Those URLs are **fetched during the scan, on sight** — not
stored for later. Telegram revokes a blob URL as soon as its message scrolls
out of the rendered window, so a URL collected early in a long chat is usually
dead by the time the download runs.

Eight kinds are detected: photos, videos, GIFs, round video messages,
stickers, voice notes, music and documents. GIFs and round messages are checked
before plain video, which would otherwise swallow both; voice and music split on
whether the bubble draws a waveform or a title row. Documents are matched last,
just before the photo fallback, because a document row often renders a thumbnail
and would otherwise be archived as the preview instead of the attachment.

Videos, GIFs, round messages and documents work differently, in two ways.

First, a `<video>` element's `blob:` URL is only the **streaming buffer**, not
the file — fetching it returns truncated or empty data. The real bytes live
behind Telegram's `/stream/...` URLs, fetched with `Range: bytes=N-` requests
that walk the `Content-Range` header until the file is assembled.

Second — and this is the non-obvious part — those `/stream/` URLs are served by
Telegram's own **service worker**. A content script runs in an isolated world,
so its `fetch()` bypasses that service worker, hits the network directly, and
gets back a bare `302` whose `Location` header is not readable cross-origin.
Chasing the redirect manually does not work for the same reason.

So the fetch is delegated to `entrypoints/page-bridge.content.ts`, declared
with `world: 'MAIN'` — the page's own JS context, where `fetch()` goes through
the service worker like any Telegram request. The two worlds share no
globals, so they talk over `window.postMessage`, and the assembled bytes come
back as a transferable `ArrayBuffer`.

Telegram **virtualizes the message list**: it keeps only a window of messages
in the DOM and recycles the same node objects as you scroll. Two consequences
the code has to handle — messages are tracked by their `data-mid` message id
rather than by DOM object identity (identity dedupe silently drops later
videos, since a reused node looks like one already seen), and a node captured
during the scan is usually detached by download time, so each message is
re-found by key before it is opened.

Detection deliberately targets the **media viewer**, not the message list.
Viewer markup (`.media-viewer-whole` on `/k/`, `.MediaViewerContent` on `/a/`)
is far more stable than the bubble classes in the scrolling list.

Mechanism credit: the Range-fetch approach follows
[neet-nestor/telegram-media-downloader](https://github.com/neet-nestor/telegram-media-downloader)
(a userscript solving the same problem). No code was copied.

## Interface

The popup is built as a transfer ledger. The type list doubles as the manifest
(counts right-aligned in mono, tabular so the column does not twitch), and the
status area is an append-only log: each phase writes a timestamped line, so a
twenty-minute run leaves a readable record instead of one overwritten string.
Repeating progress replaces its own previous line; outcomes and failures stack.

There is deliberately **no progress bar**. The process cannot know its total in
advance, so a bar would draw a number it does not have. The masthead lamp
carries run state instead: the accent pulsing while working, green on success,
red on failure. The accent is reserved for live state and the one action worth
taking.

### Theme

The popup borrows the open Telegram client's theme at runtime rather than
shipping a fixed palette — a hardcoded one is wrong for anyone running a
custom accent or theme.

`tw-sdk/theme.ts` reads Telegram's CSS custom properties off `:root`.
Property names differ between the `/k/` and `/a/` clients and have changed
across builds, so it tries known names first and then *discovers* any
colour-valued custom properties whose names match the right shape. Values are
normalised onto the same tokens `popup.html` already uses, so nothing about
the layout or components changes.

Degradation is deliberate at every step:

- **No Telegram tab** → the shipped palette stands.
- **Nothing readable** → `readTheme()` returns null rather than a half-applied
  mix, and the shipped palette stands.
- **A partial read** → only the resolved tokens are overridden; the rest keep
  their defaults.

An applied theme sets `data-themed` on `:root`, which disables the popup's own
`prefers-color-scheme` rules — otherwise a dark Telegram under a light OS would
fight the borrowed values.

Text on an accent fill is chosen by `bestOn()`, which prefers **white unless
white is genuinely unreadable**. This is deliberately not "whichever ratio is
higher": black scores 5.59:1 on a mid-violet accent against white's 3.76:1, yet
black on an accent button looks wrong and no client does it. Black is used only
for pale accents (yellow, mint) where white actually fails.

### Scrolling

Scrolling is animated (`glideTo` in `tw-sdk/dom.ts`) and paced by observation
rather than a fixed delay (`Run.waitFor` in `tw-sdk/run.ts`).

The important constraint is that **`glideTo` resolves only once the move has
landed**. The scan loop reads `scrollTop` immediately after moving to decide
whether it moved, whether the list grew, and whether it reached the top. CSS
`scroll-behavior: smooth` would make those reads return a mid-animation value,
so the loop would mis-detect a stall, stop early, and silently lose media.
Awaiting a self-driven animation keeps those reads truthful.

The scan trades speed for completeness, because a miss is permanent: Telegram
unmounts a row once it leaves the window, so media not harvested while it was
rendered is gone unless the scan passes over it again.

- **Half-screen steps.** Every row is rendered at two consecutive stops. A
  full-screen step gives each row one chance to be caught mid-load.
- **Settle, don't first-hit.** At each stop the scan keeps harvesting until the
  screenful stops yielding anything new (`SETTLE_QUIET`), rather than moving on
  as soon as one item appears. A screenful paints progressively; leaving on the
  first item abandoned the rest of it, and that alone lost roughly half a chat.
- **Two passes.** Bottom to top, then back down. A row still loading when the
  scan went past it is unmounted before it paints, and the return trip is the
  only thing that gives it a second chance. The scan therefore ends at the
  bottom; `exhausted` records that the top was reached, not the final position.
- **Growth, not stalls, ends a direction.** Reaching an end only finishes the
  sweep if `scrollHeight` stops growing after a wait — scrolling to the top is
  what makes Telegram prepend older history.

Two deliberate exceptions:

- The **deep sweep** in `tw-sdk/locate.ts` is not animated. It is time-boxed, so
  every frame spent gliding is a frame not spent searching.
- `prefers-reduced-motion` jumps instead of animating, and still lands exactly.

Both helpers abort mid-flight on a stop or chat switch, so an animation is
never a window of unabortable work.

### Stopping and continuing

A scan on a large chat runs for minutes, so it can be stopped at any point and
whatever it collected is kept. The stopped manifest is fully usable: pick types
and download exactly as after a completed scan. Its header is marked `partial`,
because those counts are a floor — the chat holds at least that much, not
only that much.

**Continue scanning** resumes from where the stop happened rather than
re-walking the chat, carrying the collected media forward. It is offered only
when the stopped pass had not already reached the top of the list.

Stop and a chat switch are deliberately different signals:

| signal | raised by | partial result |
|---|---|---|
| `Stopped` | the user pressing Stop | **kept** — that is the point |
| `Cancelled` | the open chat changing | **discarded** — it would mix two chats |

When both are pending at once the chat check runs first, so a mixed-chat result
is never offered as a partial.

### Switching chats

Telegram never reloads the page when you switch chats, so the content script
and any scan it holds survive the switch. Each scan is stamped with a chat key
(the peer id from the URL hash, falling back to the header name), and a
mismatch drops the scan and resets the popup — reached three ways: the popup
asking for state when it opens, a `hashchange` while it is already open, and a
guard on DOWNLOAD so a stale scan can never be acted on.

A run already in progress is **cancelled**, not left to finish. Without that it
would keep scrolling the new chat and merge both chats' media into one result —
worse than stale data, because nothing about the output looks wrong.

Cancellation works by checkpoint. Every long pass already awaits between steps,
so those awaits became `Run.pause()`, which re-checks the chat on resume and
throws `Cancelled`. The cross-world fetch needed its own watcher: it
resolves only on done/error, so a large video would otherwise outlive the
switch by minutes. A `Cancelled` unwinds to `begin()`, which drops the partial
result and resets the popup rather than reporting a failure.

## Known limits

- If a video fails with `HTTP 302`, the `MAIN`-world script is not running:
  check that `page-bridge.content.ts` loaded and that the extension was fully
  reloaded after any manifest change (Chrome does not hot-reload `world`
  declarations).
- The video pass is slow and visibly drives the UI: each video is opened,
  fetched, and closed in turn. Leave the tab alone while it runs. On a chat
  with hundreds of videos this legitimately takes many minutes.
- Videos are downloaded in **list order** (top of the chat downward), not in
  scan order. The scan walks bottom-to-top, so replaying that order made the
  list position and the next target drift apart: after a dozen videos every
  lookup needed a full search. Each message's scroll position is recorded
  during the scan, and the download pass seeks to it before opening.
- Re-finding a recycled message tries a cheap local search first (about a
  second). The full two-way sweep is a last resort: it is time-boxed, and only
  a small share of videos per run may use it. Without those bounds a chat with
  243 videos would spend tens of hours scrolling, which looks exactly like a
  hang. When one is running the popup says "searching the chat for it".
- Any video that fails is reported with the reason (no URL from the viewer,
  message no longer in list, HTTP error) rather than silently omitted. A
  message that stays unfound after a full two-way sweep is genuinely gone from
  the rendered list — re-scanning usually recovers it.
- Scan-time type detection still keys off message-list class names, which vary
  between Telegram builds. If a count looks wrong, that is where it went wrong.
  The voice/music split is the weakest of these: an `<audio>` with neither a
  waveform nor a title row is filed as a voice note.
- Documents are fetched from the row's own download URL, not the media viewer.
  A document Telegram has not cached yet is clicked once to start that download
  and then waited on, so a large uncached file can time out.
- Only media Telegram renders while scrolling is seen. Very long chats need
  patience; the scroll pass stops after 4 idle rounds.
- A still whose blob URL was already revoked when the scan reached it is
  counted as skipped. Scanning a very long chat slowly enough for Telegram to
  render each message is the only mitigation.

## Layout

Built on [WXT](https://wxt.dev): `wxt.config.ts` supplies the manifest fields,
and the manifest itself (background/content_scripts/side_panel) is generated
from the `entrypoints/` directory structure at build time.

    wxt.config.ts
    tw-sdk/                  pure Telegram-DOM logic, no chrome.* — importable
                             from tests and entrypoints alike
      run.ts                 one run: cancellation, stop, checkpoints
      dom.ts                 message list, chat name/identity, glideTo
      theme.ts               reads Telegram's live theme
      classify.ts            what kind of media a bubble holds
      viewer.ts               driving Telegram's media viewer
      scan.ts                 scroll the chat, inventory what is there
      locate.ts               re-finding recycled message nodes
      archive.ts              pack (buildArchive) + save (saveBlob)
      session.ts              what was scanned, and what may follow
      utils.ts, types.ts
    entrypoints/
      background.ts
      content.ts               run state + the panel message contract
      content/
        bridge.ts              client half of the cross-world fetch
        collect.ts             fetch the bytes the scan could only queue
      page-bridge.content.ts   MAIN-world Range fetch (see below)
      sidepanel/
        index.html, main.tsx, App.tsx
        components/            Hint, ManifestList, StatusLog (React)
        hooks/                 useActiveTab, useTheme, useRunState
        style.css
    assets/
      fonts/                   vendored woff2 subsets, imported from style.css
    public/
      icons/                   icon.svg (source) + 16/32/48/128 PNGs — copied
                               verbatim into the build, unlike assets/
    test/                      Vitest suites
    tools/                     naming.ts (name source), check.ts

### Icon

`public/icons/icon.svg` is the source; the four PNGs Chrome asks for are
rendered from it. The mark is an arrow descending onto a baseline — media
pulled down into the archive. Unlike the popup it cannot borrow the live
theme (Chrome renders it before any page is open), so it ships a fixed dark
ground with a violet accent.

It is tuned for **16px**, not for the 128 canvas. An earlier draft looked
correct large but fused into a blob in the toolbar, so the mark is inset and
the gap between arrowhead and floor widened. Judge any change at actual size.

To re-render after editing the SVG, rasterize it to 16/32/48/128 and re-run
`pnpm check`, which verifies each PNG's real pixel dimensions — a wrong-size
icon otherwise fails silently as a grey puzzle piece.

### Naming

`tools/naming.ts` is the single source of truth. It defines four values:

| field | value | used by |
|---|---|---|
| `product` | Telegram Media Archiver | `wxt.config.ts` manifest name, README heading, panel `<title>` |
| `short` | Telegram Media Archiver | panel masthead, toolbar tooltip |
| `slug` | telegram-media-archiver | package name, zip artifact |
| `description` | one sentence | manifest and package, verbatim |

`short` is deliberately identical to `product`. It once held a shortened name
on the assumption that the full one wrapped in the 320px masthead — measured,
it renders at 170px against a 288px budget, so the shortening bought nothing
and two names for one extension only ever read as two products. The field is
kept so callers have a single name to read.

`pnpm check` fails if any surface drifts from these values, so a name can
only be changed in one place.

## Commands

    pnpm dev      wxt dev server with hot reload (.output/chrome-mv3-dev)
    pnpm build    production build (.output/chrome-mv3)
    pnpm zip      wxt zip — packaged .zip for the store
    pnpm check    tsc --noEmit + naming/icon/asset checks (tools/check.ts)
    pnpm test     vitest run — every suite

## Tests

    pnpm install
    pnpm test

`node_modules` is gitignored and must not be present when loading the
unpacked extension directly (use `.output/chrome-mv3` from `pnpm build`).
