import { useEffect } from 'react';
import type { Theme } from '../../../tw-sdk/theme';

const TOKENS = ['vault', 'rule', 'ink', 'dim', 'signal', 'hover', 'onblue', 'err', 'ok'] as const;

// Was ui/theme.js's applyTheme(). Writes CSS custom properties straight onto
// the root element rather than through React state — these are consumed by
// plain CSS (style.css), not JSX, so there is nothing for React to re-render.
export function applyTheme(theme: Theme | null): void {
  const root = document.documentElement;
  if (!theme) {
    for (const t of TOKENS) root.style.removeProperty(`--${t}`);
    root.removeAttribute('data-themed');
    return;
  }
  // Any token the client did not expose keeps its shipped default rather
  // than being blanked.
  for (const t of TOKENS) {
    const v = (theme as unknown as Record<string, string>)[t];
    if (v) root.style.setProperty(`--${t}`, v);
  }
  // The panel's own light/dark media query would otherwise fight a borrowed
  // palette — e.g. a dark Telegram theme under a light OS. Marking the root
  // lets the stylesheet stand down and defer to these values.
  root.setAttribute('data-themed', theme.dark ? 'dark' : 'light');
}

// Applies a theme whenever it changes; does not fetch or watch on its own —
// content.ts pushes THEME messages, and the caller forwards them here.
export function useTheme(theme: Theme | null): void {
  useEffect(() => { applyTheme(theme); }, [theme]);
}
