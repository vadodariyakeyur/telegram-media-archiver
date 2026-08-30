// The palette in popup.html is the fallback, not the target: hardcoding colours
// is wrong for anyone running a custom accent. Any token the client did not
// expose keeps its shipped default rather than being blanked.
import { els } from './dom.js';

const TOKENS = ['vault', 'rule', 'ink', 'dim', 'signal', 'hover', 'onblue', 'err', 'ok'];

export function applyTheme(theme) {
  const root = document.documentElement;

  if (!theme) {
    for (const t of TOKENS) root.style.removeProperty(`--${t}`);
    root.removeAttribute('data-themed');
    return false;
  }

  for (const t of TOKENS) {
    if (theme[t]) root.style.setProperty(`--${t}`, theme[t]);
    else root.style.removeProperty(`--${t}`);
  }

  // The panel's own light/dark media query would otherwise fight a borrowed
  // palette — e.g. a dark Telegram theme under a light OS. Marking the root
  // lets the stylesheet stand down and defer to these values.
  root.setAttribute('data-themed', theme.dark ? 'dark' : 'light');
  return true;
}
