// Applying Telegram's live theme to the popup.
//
// The palette in popup.html is the fallback, not the target: hardcoding
// colours is wrong for anyone running a custom accent. The content script
// reads the open client's theme and this maps it onto the same tokens the
// stylesheet already uses, so nothing about the layout or components changes.
//
// A partial read is fine — any token the client did not expose keeps its
// shipped default rather than being blanked.
import { els } from './dom.js';

// Extension token -> the CSS custom property the stylesheet reads.
const TOKENS = ['vault', 'rule', 'ink', 'dim', 'signal', 'hover', 'onblue', 'err', 'ok'];

export function applyTheme(theme) {
  const root = document.documentElement;

  // No Telegram tab, or nothing readable: make sure any previously applied
  // values are cleared so the stylesheet's own palette takes over again.
  if (!theme) {
    for (const t of TOKENS) root.style.removeProperty(`--${t}`);
    root.removeAttribute('data-themed');
    return false;
  }

  for (const t of TOKENS) {
    if (theme[t]) root.style.setProperty(`--${t}`, theme[t]);
    else root.style.removeProperty(`--${t}`);
  }

  // The popup's own light/dark media query would otherwise fight a borrowed
  // palette — e.g. a dark Telegram theme under a light OS. Marking the root
  // lets the stylesheet stand down and defer to these values.
  root.setAttribute('data-themed', theme.dark ? 'dark' : 'light');
  return true;
}
