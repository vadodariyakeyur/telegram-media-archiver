// The session rules — what may legally follow what — used to be guard clauses
// interleaved with message plumbing in 99-main.js, which exported nothing. The
// only way to reach them was to fake the extension messaging layer, so nobody
// did, and a stale scan surviving a chat switch shipped as a bug twice.
import { describe, it, expect } from 'vitest';
import { Session } from '../tw-sdk/session';
import type { ScanResult, MediaKind, FoundItem } from '../tw-sdk/types';

const scanResult = (over: Partial<{ found: Record<string, FoundItem>; pending: ScanResult['pending']; counts: Record<string, number>; stopped: boolean; exhausted: boolean }> = {}): ScanResult => ({
  found: new Map(Object.entries(over.found || { a: { kind: 'photo' as MediaKind } })),
  pending: over.pending || [],
  counts: over.counts || { photo: 1 },
  stopped: over.stopped || false,
  at: 0,
  exhausted: over.exhausted || false,
});

describe('Session', () => {
  it('a fresh session refuses everything', () => {
    const s = new Session();
    expect(s.hasScan).toBe(false);
    expect(s.refuseDownload(['photo'])).toBe('Scan first.');
    expect(s.refuseContinue()).toBe('Nothing to continue.');
    expect(s.canContinue).toBe(false);
  });

  it('a completed scan can be downloaded, not continued', () => {
    const s = new Session().record(scanResult(), 'peer:aaa');
    expect(s.hasScan).toBe(true);
    expect(s.refuseDownload(['photo'])).toBe(null);
    expect(s.refuseContinue()).toBe('Nothing to continue.');
    expect(s.canContinue).toBe(false);
    expect(s.isPartial).toBe(false);
  });

  it('a stopped scan mid-chat can be continued, and is still downloadable', () => {
    const s = new Session().record(scanResult({ stopped: true }), 'peer:aaa');
    expect(s.refuseContinue()).toBe(null);
    expect(s.canContinue).toBe(true);
    expect(s.isPartial).toBe(true);
    expect(s.refuseDownload(['photo'])).toBe(null);
  });

  it('a stopped scan that reached the top has nothing left, but its counts are still a floor', () => {
    const s = new Session().record(scanResult({ stopped: true, exhausted: true }), 'peer:aaa');
    expect(s.refuseContinue()).toBe('Already at the top of the chat.');
    expect(s.canContinue).toBe(false);
    expect(s.isPartial).toBe(true);
  });

  it('selecting nothing is refused before anything else', () => {
    const s = new Session().record(scanResult(), 'peer:aaa');
    expect(s.refuseDownload([])).toBe('Nothing selected.');
    expect(s.refuseDownload(null as unknown as MediaKind[])).toBe('Nothing selected.');
  });

  it('THE regression: a scan must not survive a chat switch', () => {
    const s = new Session().record(scanResult(), 'peer:aaa');
    expect(s.invalidateIfChatChanged('peer:aaa')).toBe(false);
    expect(s.hasScan).toBe(true);

    expect(s.invalidateIfChatChanged('peer:bbb')).toBe(true);
    expect(s.hasScan).toBe(false);
    expect(s.refuseDownload(['photo'])).toBe('Scan first.');
  });

  it('a session with no scan must not report a switch — there is nothing to lose', () => {
    const s = new Session();
    expect(s.invalidateIfChatChanged('peer:zzz')).toBe(false);
  });

  it('switching away and back must not resurrect the scan: the captured DOM nodes are gone either way', () => {
    const s = new Session().record(scanResult(), 'peer:aaa');
    s.invalidateIfChatChanged('peer:bbb');
    expect(s.invalidateIfChatChanged('peer:aaa')).toBe(false);
    expect(s.hasScan).toBe(false);
  });

  it('itemsFor filters by the selected kinds', () => {
    const s = new Session().record(scanResult({
      found: { a: { kind: 'photo' }, b: { kind: 'video' }, c: { kind: 'photo' } },
    }), 'peer:aaa');
    expect(s.itemsFor(['photo']).length).toBe(2);
    expect(s.itemsFor(['photo', 'video']).length).toBe(3);
    expect(s.itemsFor([]).length).toBe(0);
    expect(new Session().itemsFor(['photo']).length).toBe(0);
  });

  it('clear() forgets everything', () => {
    const s = new Session().record(scanResult({ stopped: true }), 'peer:aaa');
    s.clear();
    expect(s.hasScan).toBe(false);
    expect(s.canContinue).toBe(false);
    expect(s.invalidateIfChatChanged('peer:qqq')).toBe(false);
  });
});
