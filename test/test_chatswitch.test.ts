// Telegram is a single-page app: switching chats never reloads the page, so
// the content script and any scan it holds survive the switch. Without an
// identity check the popup would show the previous chat's manifest, and a
// download would act on that chat's captured nodes.
//
// The invalidation rule itself (only a *change* from a known key resets) is
// exercised for real in test_session.test.ts against Session's own
// invalidateIfChatChanged — no need for a second mirror implementation here.
import { describe, it, expect } from 'vitest';
import { chatKey } from '../tw-sdk/dom';

const setHash = (h: string) => { window.location.hash = h; };

describe('chatKey identity', () => {
  it('peer id used when the hash carries it, and differs across chats', () => {
    setHash('#-1001234567890');
    const a = chatKey();
    expect(a.startsWith('peer:')).toBe(true);

    setHash('#-1009876543210');
    expect(chatKey()).not.toBe(a);

    setHash('#-1001234567890');
    expect(chatKey()).toBe(a);
  });

  it('/a/ style bare numeric hash handled', () => {
    setHash('#12345678');
    expect(chatKey()).toBe('peer:12345678');
  });

  it('query suffix ignored', () => {
    setHash('#12345678?thread=5');
    expect(chatKey()).toBe('peer:12345678');
  });

  it('falls back to the header name when the hash carries nothing', () => {
    setHash('');
    document.body.innerHTML =
      '<div id="column-center"><div class="chat-info"><span class="peer-title">Ops Team</span></div></div>';
    expect(chatKey()).toBe('name:Ops Team');
  });

  it('no chat open yields a sentinel', () => {
    setHash('');
    document.body.innerHTML = '<div></div>';
    expect(chatKey()).toBe('none');
  });
});
