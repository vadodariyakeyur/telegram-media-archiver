export interface HintPage { open: boolean; name: string | null; reachable: boolean }

// Kept as data rather than branches of render code so the copy for a state
// is one line, and adding a state does not mean adding a render path.
const HINTS: Record<string, [string, string[]]> = {
  offpage: ['Not on Telegram',
    ['Open <em>web.telegram.org</em> in this tab, then reopen this panel.']],
  nochat: ['No chat open',
    ['Pick a conversation in Telegram. The panel follows whatever is open.']],
  ready: ['What happens',
    ['Scanning scrolls the whole chat and counts what it finds, by type. Nothing downloads yet.',
     'You then pick the types to keep and get one <em>.zip</em>, foldered by type.']],
  scanning: ['Scanning',
    ['Keep this tab in front — Telegram stops rendering messages in a background tab, and the scan reads what is rendered.']],
  scanned: ['Pick what to keep',
    ['Tick the types you want, then Download selected. Only then are the files fetched.']],
  fetching: ['Downloading',
    ['Keep this tab in front. Cancel stops the download and saves nothing — a half archive is not worth the confusion.']],
  zipping: ['Packing',
    ['Building the archive. This step cannot be cancelled: a half-written zip is worse than a slow one.']],
};

function key(page: HintPage, phase: string): string {
  if (!page.reachable) return 'offpage';
  if (!page.open) return 'nochat';
  if (phase === 'idle' || phase === 'ready') return 'ready';
  return phase;
}

export function Hint({ page, phase }: { page: HintPage; phase: string }) {
  const k = key(page, phase);
  const [title, paras] = HINTS[k] || HINTS.ready;
  const showChat = page.name && k !== 'offpage' && k !== 'nochat';

  return (
    <div id="hint" aria-live="polite">
      <b>
        {title}
        {showChat && (
          <>
            {' · '}
            {/* A dedicated node with plain text interpolation, never innerHTML: a
                chat name is attacker-controlled — anyone can name a group
                `<img src=x onerror=…>` and this panel would run it. */}
            <span className="chat">{page.name}</span>
          </>
        )}
      </b>
      {/* dangerouslySetInnerHTML here is safe ONLY because every string in HINTS
          is a literal in this file; they carry <em> markup by design. Never feed
          page.name or any chat-derived value through this path. */}
      {paras.map((p, i) => (
        <p key={i} dangerouslySetInnerHTML={{ __html: p }} />
      ))}
    </div>
  );
}
