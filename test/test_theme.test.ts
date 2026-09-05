// The popup borrows Telegram's live theme rather than hardcoding a palette,
// because a hardcoded one is wrong for anyone running a custom accent. The
// reader must handle both clients' property names, degrade to the shipped
// defaults when nothing is readable, and never emit an unreadable pairing.
//
// Only readTheme/watchTheme are exported — isColor/toRgb/bestOn/contrast are
// private now, so they are exercised only through readTheme's output.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readTheme } from '../tw-sdk/theme';

function stubTheme(props: Record<string, string>) {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (n: string) => props[n] ?? '',
  } as CSSStyleDeclaration);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('readTheme', () => {
  it('reads a /k/ theme', () => {
    stubTheme({
      '--background-color': '#0E0E0E',
      '--primary-color': '#8675DC',
      '--primary-text-color': '#FFFFFF',
      '--secondary-text-color': '#8D8D8F',
      '--border-color': '#2B2B2C',
    });
    const t = readTheme();
    expect(t).toBeTruthy();
    expect(t!.vault).toBe('#0E0E0E');
    expect(t!.signal).toBe('#8675DC');
    expect(t!.dark).toBe(true); // a near-black ground is detected as dark
    expect(t!.hover).toBeTruthy(); // a hover shade is derived from the accent
    expect(t!.onblue).toBe('#FFFFFF'); // white reads better on this violet
  });

  it('reads /a/ client names', () => {
    stubTheme({
      '--color-background': '#FFFFFF',
      '--color-primary': '#3390EC',
      '--color-text': '#000000',
      '--color-text-secondary': '#707579',
    });
    const t = readTheme();
    expect(t!.vault).toBe('#FFFFFF');
    expect(t!.signal).toBe('#3390EC');
    expect(t!.dark).toBe(false); // a white ground is detected as light
  });

  it('an empty page yields no theme, so the popup keeps its own palette', () => {
    stubTheme({});
    expect(readTheme()).toBe(null);
  });

  it('non-colour properties do not count as a theme', () => {
    stubTheme({ '--unrelated': '12px' });
    expect(readTheme()).toBe(null);
  });

  // Junk values (none, transparent, gradients, near-transparent) are rejected
  // by the private isColor check, not passed through as a background.
  it('a transparent-only theme is rejected outright, not half-applied', () => {
    stubTheme({ '--background-color': 'transparent' });
    expect(readTheme()).toBe(null);
  });

  // The rule is NOT "whichever ratio is higher". On a mid-tone accent black
  // often wins on contrast ratio yet looks wrong, and every client puts white
  // there — this is bestOn's deliberate white-first preference, observed via
  // the accent's derived foreground.
  it('white is chosen on a violet accent even though black has the higher contrast ratio', () => {
    stubTheme({ '--primary-color': '#8675DC' });
    const t = readTheme();
    expect(t!.onblue).toBe('#FFFFFF');
  });

  it('black is chosen on a pale accent', () => {
    stubTheme({ '--primary-color': '#FFE066' });
    const t = readTheme();
    expect(t!.onblue).toBe('#000000');
  });

  it('an accent alone is still a usable theme; unresolved tokens are omitted, not blanked', () => {
    stubTheme({ '--primary-color': '#8675DC' });
    const t = readTheme();
    expect(t).toBeTruthy();
    expect(t!.signal).toBe('#8675DC');
    expect(t!.ink).toBeFalsy();
  });
});
