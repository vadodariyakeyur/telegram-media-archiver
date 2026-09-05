// Reloading the extension while a Telegram tab stays open leaves this content
// script running against a dead chrome.runtime. sendMessage then THROWS
// SYNCHRONOUSLY rather than returning a rejected promise, so a bare
// `.catch(() => {})` never sees it: one dead context would unwind whatever run
// is in flight, once per progress tick.
//
// entrypoints/content.ts is the unified target now (manifest.json's
// content_scripts array is WXT-generated, not hand-authored), so this checks
// the same property against its source rather than booting the old multi-file
// vm sandbox.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'entrypoints/content.ts'), 'utf8');

describe('dead extension context', () => {
  it('sendMessage is wrapped in try/catch, not only .catch()', () => {
    expect(/try\s*{[^}]*chrome\.runtime\.sendMessage/.test(src)).toBe(true);
  });

  it('every send() checks liveness before touching chrome.runtime', () => {
    // alive() reads chrome.runtime?.id inside its own try/catch, so an
    // orphaned tab (runtime stripped off chrome entirely) never reaches the
    // sendMessage call at all.
    expect(/const alive = \(\) => {\s*\n\s*try { return !!chrome\.runtime\?\.id/.test(src)).toBe(true);
    expect(/function send\(m: Record<string, unknown>\): void {\s*\n\s*if \(!alive\(\)\) return;/.test(src)).toBe(true);
  });

  it('the message listener registration is itself guarded, not bare at load time', () => {
    // A bare top-level chrome.runtime.onMessage.addListener throws before any
    // listener exists in an orphaned tab, taking the whole content script with it.
    expect(/if \(alive\(\)\) chrome\.runtime\.onMessage\.addListener/.test(src)).toBe(true);
  });

  it('the theme watcher is also guarded at load time', () => {
    expect(/if \(alive\(\)\) {\s*\n\s*try { watchTheme/.test(src)).toBe(true);
  });

  it('the body observer registration is wrapped, so a throw here does not kill the script', () => {
    expect(/if \(alive\(\)\) {\s*\n\s*try {\s*\n\s*new MutationObserver/.test(src)).toBe(true);
  });

  // --- the content script only announces real page changes -----------------
  it('repeat page states are suppressed rather than spamming the panel', () => {
    expect(/lastPage/.test(src)).toBe(true);
    expect(/if \(sig === lastPage\) return;/.test(src)).toBe(true);
  });

  it('the body observer is coalesced — a scan renders thousands of nodes', () => {
    expect(/pageQueued/.test(src)).toBe(true);
  });

  it('a reopened panel is re-told the page state, not suppressed as a duplicate', () => {
    expect(/lastPage = '';\s*\n\s*announcePage\(\);/.test(src)).toBe(true);
  });
});
