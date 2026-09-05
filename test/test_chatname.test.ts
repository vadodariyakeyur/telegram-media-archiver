import { describe, it, expect } from 'vitest';
import { chatName, safeName } from '../tw-sdk/dom';

describe('chatName', () => {
  it('header-scoped lookup beats the sidebar first-match bug: .peer-title appears in both', () => {
    document.body.innerHTML = `
      <div id="column-center">
        <div class="chat-info"><span class="peer-title">Right Chat</span></div>
      </div>
      <div class="sidebar"><span class="peer-title">Wrong Chat (top of list)</span></div>
    `;
    expect(chatName()).toBe('Right Chat');
  });

  it('/a/ client: #MiddleColumn .ChatInfo h3', () => {
    document.body.innerHTML = `
      <div id="MiddleColumn"><div class="ChatInfo"><h3>A Client Chat</h3></div></div>
    `;
    expect(chatName()).toBe('A Client Chat');
  });

  it('falls back to the tab title with the unread-badge count stripped', () => {
    document.body.innerHTML = '<div id="column-center"></div>';
    document.title = '(12) Fallback Chat';
    expect(chatName()).toBe('Fallback Chat');
  });

  it('a generic title ("Telegram") is rejected in favor of the sentinel', () => {
    document.body.innerHTML = '<div id="column-center"></div>';
    document.title = 'Telegram';
    expect(chatName()).toBe('telegram-chat');
  });
});

describe('safeName', () => {
  it('strips path separators', () => {
    expect(safeName('a/b\\c')).toBe('abc');
  });

  it('collapses whitespace', () => {
    expect(safeName('a   b   c')).toBe('a b c');
  });

  it('falls back to the sentinel when nothing survives', () => {
    expect(safeName('')).toBe('telegram-chat');
    expect(safeName('///???')).toBe('telegram-chat');
  });

  it('preserves unicode / CJK names', () => {
    expect(safeName('日本語チャット')).toBe('日本語チャット');
  });

  it('caps length at 60', () => {
    expect(safeName('a'.repeat(200)).length).toBe(60);
  });
});
