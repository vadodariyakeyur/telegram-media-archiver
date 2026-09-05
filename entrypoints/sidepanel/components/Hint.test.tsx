// The panel's instruction box must track the PAGE, not just the run: a chat
// that is not open makes every run instruction moot. It must also never let a
// chat name — which anyone can set — reach the panel as markup.
//
// The Scan button's disabled state moved to useRunState.ts, out of Hint.tsx's
// own scope, so that half of the old test belongs there, not here.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Hint, type HintPage } from './Hint';

// No setupFiles in vitest.config.ts, so RTL's auto-cleanup never runs —
// each render() here must be unmounted or the next test's queries see both.
afterEach(cleanup);

const page = (p: Partial<HintPage>): HintPage => ({ open: true, name: null, reachable: true, ...p });

describe('Hint', () => {
  it('an open chat with no run explains the flow', () => {
    render(<Hint page={page({ name: 'Design' })} phase="idle" />);
    // The title shares a <b> with the chat name (`What happens · Design`), so
    // an exact-text query for the title alone won't match the combined node.
    expect(document.querySelector('#hint b')?.textContent).toContain('What happens');
  });

  it('a running scan says what it is doing', () => {
    render(<Hint page={page({ name: 'Design' })} phase="scanning" />);
    expect(document.querySelector('#hint b')?.textContent).toContain('Scanning');
  });

  // The chat closing mid-run outranks the run's own instruction: telling the
  // user to keep the tab in front is useless once there is nothing to scan.
  it('no chat outranks a live run phase', () => {
    render(<Hint page={page({ open: false })} phase="scanning" />);
    expect(screen.getByText('No chat open')).toBeTruthy();
  });

  it('an unreachable tab outranks everything', () => {
    render(<Hint page={page({ name: 'Design', reachable: false })} phase="scanning" />);
    expect(screen.getByText('Not on Telegram')).toBeTruthy();
  });

  // A dedicated node with plain text interpolation, never innerHTML: a chat
  // name is attacker-controlled — anyone can name a group
  // `<img src=x onerror=…>` and this panel would run it.
  it('a chat name is shown as text, never as markup', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { container } = render(<Hint page={page({ name: evil })} phase="idle" />);

    // The name is visible, escaped — not parsed into an element.
    expect(screen.getByText(evil)).toBeTruthy();
    expect(container.innerHTML).toContain('&lt;img');
    expect(container.querySelector('img')).toBe(null);
  });
});
