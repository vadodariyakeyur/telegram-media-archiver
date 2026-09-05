// Entry point: owns run state and the panel message contract.
// Nothing else imported here talks to chrome.runtime.
import { Session } from '../tw-sdk/session';
import { chatKey, chatName } from '../tw-sdk/dom';
import { startRun, currentRun, endRun, Stopped, Cancelled } from '../tw-sdk/run';
import { scanChat, type ScanReport } from '../tw-sdk/scan';
import { zipAndSave } from '../tw-sdk/archive';
import { TYPES } from '../tw-sdk/classify';
import { readTheme, watchTheme } from '../tw-sdk/theme';
import { loadPending } from './content/collect';
import type { MediaKind } from '../tw-sdk/types';

export default defineContentScript({
  matches: ['https://web.telegram.org/*'],
  runAt: 'document_idle',
  main() {
    let running = false;
    // The panel can be closed, taking its message listener with it. Keep the latest
    // state here so a reopened panel can ask for it instead of showing blank.
    let state: Record<string, unknown> = { type: 'IDLE' };

    const session = new Session();

    function invalidateIfChatChanged(): boolean {
      if (!session.invalidateIfChatChanged(chatKey())) return false;
      state = { type: 'RESET' };
      return true;
    }

    // Reloading the extension leaves this script running in a tab it can no longer
    // talk to: Chrome keeps `chrome` but strips `runtime` off it. Every use has to
    // tolerate that, including the load-time registration below — a bare
    // `chrome.runtime.onMessage` throws before any listener exists.
    const alive = () => {
      try { return !!chrome.runtime?.id; } catch { return false; }
    };

    // Sending to a closed panel rejects; that is expected, so swallow it.
    //
    // A dead context is different: sendMessage THROWS SYNCHRONOUSLY rather than
    // returning a rejected promise, so .catch() alone never sees it. Unguarded,
    // that throw unwinds whatever run is in flight, once per progress tick.
    function send(m: Record<string, unknown>): void {
      if (!alive()) return;
      try { chrome.runtime.sendMessage(m)?.catch(() => {}); } catch { /* context gone */ }
    }

    const push = (m: Record<string, unknown>) => { state = m; send(m); };

    function begin(job: () => Promise<void>): boolean {
      if (running) return false;
      running = true;
      // Constructing the run replaces "stamp the chat, then clear the stop flag":
      // a run starts with fresh state, so a stop can never leak into the next one.
      const run = startRun(chatKey());

      job()
        .catch(e => {
          if (e instanceof Stopped) {
            push({ type: 'STOPPED' });
          } else if (e instanceof Cancelled) {
            // Not a failure to report — the chat changed underneath it. Drop the
            // partial result and reset the panel.
            session.clear();
            push({ type: 'RESET', reason: 'chat-changed' });
          } else {
            push({ type: 'ERROR', message: (e as Error).message });
          }
        })
        .finally(() => { running = false; endRun(run); });
      return true;
    }

    function scanProgress(p: ScanReport): Record<string, unknown> {
      const m: Record<string, unknown> = { type: 'PROGRESS', ...p };
      if (p.counts) m.types = typeRows(p.counts);
      delete m.counts;
      return m;
    }

    // The content script owns the type names, so the panel keeps no second copy.
    function typeRows(counts: Record<string, number>) {
      return Object.entries(counts || {})
        .filter(([, n]) => n > 0)
        .map(([kind, n]) => ({ kind, label: TYPES[kind as MediaKind] || kind, count: n }));
    }

    function announceScan(): void {
      const types = typeRows(session.scan!.counts);
      if (!types.length) {
        throw new Error(session.isPartial
          ? 'Stopped before any media was found.'
          : 'No media found in this chat.');
      }
      push({
        type: 'SCANNED',
        types,
        partial: session.isPartial,
        resumable: session.canContinue,
      });
    }

    // Deliberately send() and NOT push(): the theme is not run state, and storing
    // it would hand a palette back to the next GET_STATE in place of run status.
    if (alive()) {
      try { watchTheme(theme => send({ type: 'THEME', theme })); } catch { /* no theme available */ }
    }

    // A stale script in an orphaned tab has nothing to listen for, so skip the
    // registration rather than throwing at load.
    if (alive()) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'GET_STATE') {
        // A panel opening after a chat switch must not be handed stale results.
        if (!running) invalidateIfChatChanged();
        sendResponse(state);
        // A freshly opened panel has no page state yet, and no mutation may arrive
        // for minutes in a quiet chat. Reset the signature so this is never
        // suppressed as a duplicate of what a PREVIOUS panel was told.
        lastPage = '';
        announcePage();
        return;
      }

      if (msg.type === 'GET_THEME') {
        let theme = null;
        try { theme = readTheme(); } catch { theme = null; }
        sendResponse({ theme });
        return;
      }

      if (msg.type === 'STOP') {
        if (!running) { sendResponse({ error: 'Nothing running.' }); return; }
        currentRun()?.stop();
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === 'CONTINUE') {
        if (invalidateIfChatChanged()) {
          sendResponse({ error: 'Chat changed. Scan again.' });
          return;
        }
        const refusal = session.refuseContinue();
        if (refusal) { sendResponse({ error: refusal }); return; }

        const ok = begin(async () => {
          const key = chatKey();
          const result = await scanChat(p => push(scanProgress(p)), session.scan);
          session.record(result, key);
          announceScan();
        });
        sendResponse(ok ? { ok: true } : { error: 'Already running.' });
        return;
      }

      if (msg.type === 'SCAN') {
        const ok = begin(async () => {
          const key = chatKey();
          const result = await scanChat(p => push(scanProgress(p)));
          session.record(result, key);
          announceScan();
        });
        sendResponse(ok ? { ok: true } : { error: 'Already running.' });
        return;
      }

      if (msg.type === 'DOWNLOAD') {
        const kinds: MediaKind[] = msg.kinds || [];
        if (invalidateIfChatChanged()) {
          sendResponse({ error: 'Chat changed. Scan again.' });
          return;
        }
        const refusal = session.refuseDownload(kinds);
        if (refusal) { sendResponse({ error: refusal }); return; }

        const ok = begin(async () => {
          // Deferred kinds (video, gif, round, documents) have no bytes in the page,
          // so fetch those first; the reasons any of them failed are worth showing.
          const { failures: fails, stopped } = await loadPending(
            session.scan!.found, session.scan!.pending, kinds,
            p => push({ type: 'PROGRESS', ...p }));
          // A stopped download saves NOTHING. This is the opposite of a stopped
          // scan, deliberately: a scan's partial manifest is the point of stopping
          // one, but a partial zip is a file the user has to notice is incomplete,
          // and its name says nothing about that. Cancel means cancel.
          if (stopped) throw new Stopped();

          const items = session.itemsFor(kinds);
          // Report why they failed rather than a generic empty-set message — the
          // reason is the only thing that makes this debuggable.
          if (!items.length) {
            throw new Error(fails.length
              ? `All ${fails.length} failed: ${[...new Set(fails)].join('; ')}`
              : 'Nothing to download for the selected types.');
          }
          const res = await zipAndSave(items, p => push({ type: 'PROGRESS', ...p }));
          push({
            type: 'DONE', ...res,
            fetchFailed: fails.length,
            reasons: [...new Set(fails)].slice(0, 3),
          });
        });
        sendResponse(ok ? { ok: true } : { error: 'Already running.' });
        return;
      }
    });

    // What chat the panel is looking at, so it can say what to do about it.
    // Deliberately send() and NOT push(): this is page state, not run state — the
    // next GET_STATE must answer with the run, not with a chat name.
    function pageInfo(): Record<string, unknown> {
      const key = chatKey();
      return { type: 'PAGE', open: key !== 'none', name: key === 'none' ? null : chatName() };
    }

    let lastPage = '';
    function announcePage(): void {
      const info = pageInfo();
      // The observer below fires on every header repaint (typing indicators, online
      // status), so only a real change is worth a message.
      const sig = `${info.open}|${info.name}`;
      if (sig === lastPage) return;
      lastPage = sig;
      send(info);
    }

    // A subtree observer on the whole body fires per rendered message, and a scan
    // renders thousands — reading the header on each would put a DOM query in the
    // scroll loop's hot path. One check per frame is far more than enough for a
    // chat switch a human performed.
    let pageQueued = false;
    function queuePageCheck(): void {
      if (pageQueued) return;
      pageQueued = true;
      setTimeout(() => { pageQueued = false; announcePage(); }, 250);
    }

    // The panel may be open while the user switches chats, in which case nothing
    // would ask for state.
    addEventListener('hashchange', () => {
      announcePage();
      // A run in progress cancels itself: its next checkpoint sees the chat no
      // longer matches and unwinds, which pushes RESET from begin()'s handler.
      if (running) return;
      if (invalidateIfChatChanged()) send(state);
    });

    // Both clients swap the open chat WITHOUT touching the URL in some flows
    // (search results, the archived list), so hashchange alone misses those.
    // Observing document.body rather than the header: the header element itself is
    // replaced on a chat switch, so an observer bound to it would watch a detached
    // node from then on.
    // try/catch for the same reason as the listener registration above: this runs
    // at load, and anything that throws here takes the whole content script with
    // it — the panel would then see a tab with no archiver in it at all.
    if (alive()) {
      try {
        new MutationObserver(queuePageCheck)
          .observe(document.body, { childList: true, subtree: true });
      } catch { /* no observer: hashchange still covers URL navigation */ }
    }
  },
});
