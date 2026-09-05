// The manifest updates in place while a scan runs. Rebuilding it each tick
// would discard the user's checkbox selection, so a re-render must touch only
// the numbers — and must still add types that first appear mid-scan. This is
// now ManifestList's own state (checked), not a parallel copy in a reducer, so
// a running scan's changing `types` reference can never fight the user's clicks.
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ManifestList } from '../entrypoints/sidepanel/components/ManifestList';

// No setupFiles in vitest.config.ts, so RTL's auto-cleanup never runs —
// render()'s queries are scoped to document.body by default, so a prior
// test's un-unmounted tree stays visible to the next test's getByText.
afterEach(cleanup);

const row = (container: HTMLElement, kind: string) => container.querySelector(`#t_${kind}`)?.closest('.row');
const countOf = (container: HTMLElement, kind: string) => row(container, kind)?.querySelector('.n')?.textContent;
const checkedOf = (container: HTMLElement, kind: string) =>
  (row(container, kind)?.querySelector('input') as HTMLInputElement | undefined)?.checked;

describe('ManifestList live counts', () => {
  it('first tick creates the manifest', () => {
    const { container } = render(
      <ManifestList types={[{ kind: 'photo', label: 'Photos', count: 3 }]} partial={false} onSelectionChange={() => {}} />
    );
    expect(container.querySelectorAll('.row').length).toBe(1);
    expect(countOf(container, 'photo')).toBe('3');
  });

  it("a later tick does not resurrect a selection the user cleared, and counts climb", () => {
    const { container, rerender } = render(
      <ManifestList types={[{ kind: 'photo', label: 'Photos', count: 3 }]} partial={false} onSelectionChange={() => {}} />
    );
    fireEvent.click(row(container, 'photo')!.querySelector('input')!);
    expect(checkedOf(container, 'photo')).toBe(false);

    rerender(<ManifestList types={[{ kind: 'photo', label: 'Photos', count: 17 }]} partial={false} onSelectionChange={() => {}} />);
    expect(countOf(container, 'photo')).toBe('17');
    expect(checkedOf(container, 'photo')).toBe(false);
    expect(container.querySelectorAll('.row').length).toBe(1);
  });

  it('a type first seen mid-scan is appended, checked, without disturbing the existing selection', () => {
    const { container, rerender } = render(
      <ManifestList types={[{ kind: 'photo', label: 'Photos', count: 3 }]} partial={false} onSelectionChange={() => {}} />
    );
    fireEvent.click(row(container, 'photo')!.querySelector('input')!);

    rerender(<ManifestList types={[
      { kind: 'photo', label: 'Photos', count: 20 },
      { kind: 'video', label: 'Videos', count: 2 },
    ]} partial={false} onSelectionChange={() => {}} />);

    expect(container.querySelectorAll('.row').length).toBe(2);
    expect(countOf(container, 'video')).toBe('2');
    expect(checkedOf(container, 'video')).toBe(true);
    expect(checkedOf(container, 'photo')).toBe(false);
  });

  it('counts keep updating across ticks without adding rows', () => {
    const { container, rerender } = render(
      <ManifestList types={[
        { kind: 'photo', label: 'Photos', count: 20 },
        { kind: 'video', label: 'Videos', count: 2 },
      ]} partial={false} onSelectionChange={() => {}} />
    );
    rerender(<ManifestList types={[
      { kind: 'photo', label: 'Photos', count: 41 },
      { kind: 'video', label: 'Videos', count: 9 },
    ]} partial={false} onSelectionChange={() => {}} />);

    expect(countOf(container, 'photo')).toBe('41');
    expect(countOf(container, 'video')).toBe('9');
    expect(container.querySelectorAll('.row').length).toBe(2);
  });

  // Empty `types` renders the empty placeholder outright (see ManifestList's
  // `if (!types?.length) return <div id="types" className="empty" />`) — there
  // is no in-place "tick" distinct from a fresh render in this component, so
  // the old test's "empty update leaves the manifest alone" case does not
  // apply to the real component's actual contract.
  it('an empty types array renders the empty placeholder, not stale rows', () => {
    const { container } = render(<ManifestList types={[]} partial={false} onSelectionChange={() => {}} />);
    expect(container.querySelector('#types.empty')).toBeTruthy();
  });

  it('a fresh mount starts all types selected', () => {
    const { container } = render(
      <ManifestList types={[{ kind: 'photo', label: 'Photos', count: 1 }]} partial={false} onSelectionChange={() => {}} />
    );
    expect(checkedOf(container, 'photo')).toBe(true);
  });

  it('Select all and Clear set every row at once', () => {
    const { container, getByText } = render(
      <ManifestList types={[
        { kind: 'photo', label: 'Photos', count: 1 },
        { kind: 'video', label: 'Videos', count: 1 },
      ]} partial={false} onSelectionChange={() => {}} />
    );
    fireEvent.click(getByText('Clear'));
    expect(checkedOf(container, 'photo')).toBe(false);
    expect(checkedOf(container, 'video')).toBe(false);

    fireEvent.click(getByText('Select all'));
    expect(checkedOf(container, 'photo')).toBe(true);
    expect(checkedOf(container, 'video')).toBe(true);
  });

  it('onSelectionChange reports only the checked kinds', () => {
    const selections: string[][] = [];
    const { container } = render(
      <ManifestList types={[
        { kind: 'photo', label: 'Photos', count: 1 },
        { kind: 'video', label: 'Videos', count: 1 },
      ]} partial={false} onSelectionChange={s => selections.push(s)} />
    );
    fireEvent.click(row(container, 'video')!.querySelector('input')!);
    expect(selections[selections.length - 1]).toEqual(['photo']);
  });
});
