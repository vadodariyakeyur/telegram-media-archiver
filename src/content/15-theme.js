// Reading Telegram's live theme off the page.
//
// Hardcoding a palette breaks anyone running a custom accent, so the panel
// borrows the client's own colours. Property names differ between the /k/ and
// /a/ clients and change across builds, so known names are tried first and a
// discovery pass follows. Unresolved tokens are omitted, and the panel keeps
// its shipped default for those — a partial read degrades, never breaks.

// Most specific first: the first name resolving to a colour wins.
const THEME_KEYS = {
  vault: ['--background-color', '--color-background', '--theme-background-color',
          '--body-background-color'],
  rule:  ['--border-color', '--color-borders', '--divider-color',
          '--color-borders-input'],
  ink:   ['--primary-text-color', '--color-text', '--text-color'],
  dim:   ['--secondary-text-color', '--color-text-secondary',
          '--secondary-color', '--hint-color'],
  signal:['--primary-color', '--color-primary', '--accent-color',
          '--theme-button-color', '--link-color'],
  err:   ['--danger-color', '--color-error', '--error-color', '--destructive-color'],
  ok:    ['--success-color', '--color-green', '--online-color'],
};

// Substring hints for the discovery pass, when no known name matched.
const DISCOVER = {
  vault: [/background(-color)?$/],
  rule:  [/border/, /divider/],
  ink:   [/text(-color)?$/, /^--color-text$/],
  dim:   [/secondary/, /hint/],
  signal:[/primary/, /accent/, /link/],
  err:   [/danger/, /error/, /destructive/],
  ok:    [/success/, /green/, /online/],
};

function isColor(v) {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent' || s === 'inherit') return false;
  if (s.includes('gradient') || s.includes('url(')) return false;
  if (!/^(#|rgba?\(|hsla?\()/.test(s)) return false;
  // Near-transparent values would render as unstyled.
  const alpha = /^rgba?\([^)]*?,\s*([\d.]+)\s*\)$/.exec(s)
             || /^hsla?\([^)]*?,\s*([\d.]+)\s*\)$/.exec(s);
  if (alpha && parseFloat(alpha[1]) < 0.5) return false;
  return true;
}

// Same-origin stylesheets only; a cross-origin sheet throws on .cssRules and
// is skipped rather than aborting the read.
function rootCustomProps() {
  const names = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }   // cross-origin
    if (!rules) continue;
    for (const rule of rules) {
      if (!rule.selectorText || !/(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText)) continue;
      for (const prop of rule.style) if (prop.startsWith('--')) names.add(prop);
    }
  }
  return names;
}

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const get = n => cs.getPropertyValue(n);
  const out = {};

  for (const [token, candidates] of Object.entries(THEME_KEYS)) {
    for (const name of candidates) {
      const v = get(name);
      if (isColor(v)) { out[token] = v.trim(); break; }
    }
  }

  // Discover by name shape, for builds that renamed things.
  const missing = Object.keys(THEME_KEYS).filter(t => !out[t]);
  if (missing.length) {
    const all = [...rootCustomProps()];
    for (const token of missing) {
      const patterns = DISCOVER[token] || [];
      const hit = all.find(n => patterns.some(p => p.test(n)) && isColor(get(n)));
      if (hit) out[token] = get(hit).trim();
    }
  }

  // No background and no accent is not a theme; report nothing so the panel
  // keeps its own palette rather than a half-applied mix.
  if (!out.vault && !out.signal) return null;

  if (out.signal) out.hover = lighten(out.signal, 0.12);
  if (out.signal) out.onblue = bestOn(out.signal);

  out.dark = isDark(out.vault || '#000');
  return out;
}

// Parse to [r,g,b] 0-255, or null. Handles #rgb, #rrggbb, rgb(), rgba().
function toRgb(c) {
  const s = (c || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map(ch => parseInt(ch + ch, 16));
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

function relLum(rgb) {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isDark(c) {
  const rgb = toRgb(c);
  return rgb ? relLum(rgb) < 0.35 : true;
}

function contrast(a, b) {
  const ra = toRgb(a), rb = toRgb(b);
  if (!ra || !rb) return 1;
  const la = relLum(ra), lb = relLum(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Deliberately NOT "whichever has more contrast". On a mid-tone accent black
// often wins on ratio (black on #8675DC is 5.59:1 vs white's 3.76:1) yet looks
// wrong — every client puts white on its accent. So white is preferred and
// black used only when white is genuinely unreadable (pale accents).
function bestOn(bg) {
  const white = contrast('#FFFFFF', bg);
  if (white >= 3) return '#FFFFFF';
  return contrast('#000000', bg) > white ? '#000000' : '#FFFFFF';
}

function lighten(c, amount) {
  const rgb = toRgb(c);
  if (!rgb) return c;
  const up = rgb.map(v => Math.round(v + (255 - v) * amount));
  return `rgb(${up.join(', ')})`;
}

// The panel stays open across a theme switch (a popup did not), so a one-shot
// read at open is not enough.
//
// Serialised compare rather than a dirty flag: a class change does not always
// mean the colours moved, and re-pushing an identical palette would repaint
// the panel on every unrelated attribute write.
function watchTheme(onChange) {
  let last = JSON.stringify(readTheme());
  const check = () => {
    let now;
    try { now = readTheme(); } catch { return; }
    const s = JSON.stringify(now);
    if (s === last) return;
    last = s;
    onChange(now);
  };
  const obs = new MutationObserver(check);

  // Day/night: the client toggles a class on <html>.
  obs.observe(document.documentElement, {
    attributes: true, attributeFilter: ['class', 'style'],
  });

  // Custom accent: no attribute moves — the client rewrites its injected
  // stylesheet instead, so watch <head> for sheets being swapped or edited.
  obs.observe(document.head, { childList: true, subtree: true, characterData: true });
}

// --- exports ---
TG.readTheme = readTheme;
TG.watchTheme = watchTheme;
