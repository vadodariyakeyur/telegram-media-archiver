// Switching chats mid-scan used to let the pass keep scrolling the NEW chat
// and merge both chats' media into one result — worse than stale data, because
// nothing looked wrong. Every long pass must abort at its next checkpoint.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../tw-sdk/dom', () => ({ chatKey: () => openChat }));

let openChat = 'peer:aaa';

const { startRun, Cancelled, Stopped } = await import('../tw-sdk/run');

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// True when `at` falls inside a `finally { ... }` body. Brace counting is
// enough here: these files have no braces inside strings or regexes.
function inFinally(src: string, at: number): boolean {
  const re = /\bfinally\s*{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) && m.index < at) {
    let depth = 1;
    for (let i = m.index + m[0].length; i < src.length && depth > 0; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      if (i === at) return depth > 0;
    }
  }
  return false;
}

beforeEach(() => { openChat = 'peer:aaa'; });

describe('cancellation', () => {
  it('a run checks the chat it started in', () => {
    const run = startRun('peer:aaa');
    expect(() => run.check()).not.toThrow();

    openChat = 'peer:bbb';
    expect(() => run.check()).toThrow(/Chat changed/);
    expect(() => run.check()).toThrow(Cancelled);
  });

  // A run with no chat (the inert stand-in) has nothing to compare against.
  it('a run outside any chat never self-cancels', () => {
    expect(() => startRun(null).check()).not.toThrow();
  });

  it('the two signals stay distinguishable', () => {
    expect(new Cancelled()).toBeInstanceOf(Error);
    expect(new Stopped()).toBeInstanceOf(Error);
    // Stopped is not a Cancelled: they mean opposite things for data.
    expect(new Stopped()).not.toBeInstanceOf(Cancelled);
  });

  it('pause() is the checkpoint every loop awaits', async () => {
    openChat = 'peer:aaa';
    let run = startRun('peer:aaa');
    await expect(run.pause(1)).resolves.not.toThrow();

    openChat = 'peer:ccc';
    await expect(run.pause(1)).rejects.toThrow(/Chat changed/);

    // A switch DURING the sleep must still abort on resume — the real sequence.
    openChat = 'peer:aaa';
    run = startRun('peer:aaa');
    const parked = run.pause(30);
    openChat = 'peer:ddd';
    await expect(parked).rejects.toThrow(/Chat changed/);
  });

  it('a scan-shaped loop unwinds and keeps nothing from the new chat', async () => {
    openChat = 'peer:aaa';
    const run = startRun('peer:aaa');
    let rounds = 0;
    const collected: string[] = [];
    const loop = (async () => {
      for (let i = 0; i < 50; i++) { rounds++; collected.push(openChat); await run.pause(1); }
    })();
    setTimeout(() => { openChat = 'peer:eee'; }, 8);
    await expect(loop).rejects.toThrow(/Chat changed/);
    expect(rounds).toBeLessThan(50);
    expect(collected.every(c => c === 'peer:aaa')).toBe(true);
  });

  // Assert the PROPERTY, not one spelling: pause(), waitFor() and glideTo()
  // all abort on resume, so requiring a literal name would fail on a correct
  // refactor — as it did when cancellation moved behind Run.
  it('every long pass still awaits a cancellable checkpoint', () => {
    const CANCELLABLE = /await (run\(\)\.(pause|waitFor)|glideTo)\(/;
    for (const f of ['tw-sdk/scan.ts', 'tw-sdk/locate.ts',
                     'entrypoints/content/collect.ts', 'tw-sdk/viewer.ts']) {
      const s = read(f);
      expect(CANCELLABLE.test(s)).toBe(true);
      // Raw sleep is allowed inside a finally and ONLY there: a throw from a
      // finally REPLACES a pending break, unwinding a pass that had already
      // stopped cleanly and discarding everything it fetched.
      for (const line of s.split('\n')) {
        if (!/await sleep\(/.test(line)) continue;
        expect(inFinally(s, s.indexOf(line))).toBe(true);
      }
    }
  });

  it('waitFor polls through pause(), so it aborts mid-wait', () => {
    const runSrc = read('tw-sdk/run.ts');
    expect(/async waitFor[\s\S]*this\.pause\(/.test(runSrc)).toBe(true);
  });

  // The two sites that cannot await must read the reason synchronously.
  it('sites that cannot await abort via abortReason() instead', () => {
    for (const f of ['tw-sdk/dom.ts', 'entrypoints/content/bridge.ts']) {
      expect(/abortReason\(\)/.test(read(f))).toBe(true);
    }
  });
});
