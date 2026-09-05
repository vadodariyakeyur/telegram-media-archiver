// Node recycling is what silently dropped 14 of 24 videos: Telegram reuses the
// same DOM object for different messages, so object-identity dedupe rejected
// later videos as "already seen". These checks pin the key-based behaviour.
import { describe, it, expect } from 'vitest';
import { bubbleKey } from '../tw-sdk/classify';

const mk = (attrs: Record<string, string>, html = '') => {
  const d = document.createElement('div');
  d.className = 'bubble';
  for (const [k, v] of Object.entries(attrs)) d.setAttribute(k, v);
  d.innerHTML = html;
  document.body.appendChild(d);
  return d;
};

describe('bubbleKey', () => {
  it('different mids differ', () => {
    const a = mk({ 'data-mid': '101' });
    const b = mk({ 'data-mid': '102' });
    expect(bubbleKey(a)).not.toBe(bubbleKey(b));
  });

  it('the regression itself: a recycled DOM object reused for two messages yields a new key', () => {
    const recycled = mk({ 'data-mid': '201' });
    const k1 = bubbleKey(recycled);
    recycled.setAttribute('data-mid', '202'); // Telegram reuses the node
    const k2 = bubbleKey(recycled);
    expect(k1).not.toBe(k2);
  });

  it('the same message re-rendered as a different object keeps one key', () => {
    const first = mk({ 'data-mid': '301' });
    const again = mk({ 'data-mid': '301' });
    expect(bubbleKey(first)).toBe(bubbleKey(again));
  });

  it('alternative id attributes are honoured', () => {
    expect(bubbleKey(mk({ 'data-message-id': '77' })).startsWith('id:')).toBe(true);
    expect(bubbleKey(mk({ id: 'message-88' })).startsWith('id:')).toBe(true);
  });

  it('with no id at all, the fingerprint still separates different videos', () => {
    const f1 = mk({}, '<span>0:42</span>');
    const f2 = mk({}, '<span>1:15</span>');
    expect(bubbleKey(f1).startsWith('fp:')).toBe(true);
    expect(bubbleKey(f1)).not.toBe(bubbleKey(f2));
  });

  it('simulates the scan loop: 24 videos, half delivered on only 2 recycled nodes, all queued distinctly', () => {
    const pending: { key: string; bubble: Element }[] = [];
    const push = (bubble: Element) => {
      const key = bubbleKey(bubble);
      const seen = pending.find(p => p.key === key);
      if (seen) seen.bubble = bubble; else pending.push({ key, bubble });
    };
    const pool = [mk({ 'data-mid': 'x' }), mk({ 'data-mid': 'y' })]; // 2 reused nodes
    for (let i = 1; i <= 24; i++) {
      const node = pool[i % 2]; // Telegram hands back a reused node
      node.setAttribute('data-mid', String(1000 + i));
      push(node);
    }
    expect(pending.length).toBe(24);
  });
});
