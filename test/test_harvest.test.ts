// Telegram revokes a blob: URL once its message scrolls out of the rendered
// window. Storing the URL and fetching later loses those bytes (53 of 129
// photos in one real run). harvest() must fetch on sight instead.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { harvest, DEFERRED } from '../tw-sdk/classify';
import type { FoundItem, PendingItem } from '../tw-sdk/types';

// Blob URLs that can be revoked, mimicking Telegram's behaviour.
let live: Map<string, number>;
let nextId: number;
const makeUrl = (bytes: number) => { const u = `blob:tg/${++nextId}`; live.set(u, bytes); return u; };
const revoke = (u: string) => live.delete(u);

// harvest returns the in-flight fetches rather than awaiting them, so the
// caller can report counts first. `await harvest(...)` resolves the ARRAY, not
// the promises in it — settle them, exactly as the scan loop does.
const sweep = async (found: Map<string, FoundItem>, pending: PendingItem[]) =>
  Promise.all(harvest(found, pending));

const addPhoto = () => {
  const b = document.createElement('div');
  b.className = 'bubble';
  const img = document.createElement('img');
  const url = makeUrl(2048);
  img.src = url;
  Object.defineProperty(img, 'currentSrc', { value: url });
  Object.defineProperty(img, 'naturalWidth', { value: 800 });
  b.appendChild(img);
  document.body.appendChild(b);
  return url;
};

beforeEach(() => {
  live = new Map();
  nextId = 0;
  document.body.innerHTML = '';
  vi.stubGlobal('fetch', async (u: string) =>
    live.has(u)
      ? { ok: true, blob: async () => ({ size: live.get(u), type: 'image/jpeg' }) }
      : { ok: false, blob: async () => null });
});

describe('harvest', () => {
  // A kind added to DEFERRED must not silently stay non-deferred here — assert
  // against the real export rather than a hand-copied set that could drift.
  it('gif/video/round/file are deferred to the collect pass, not fetched eagerly', () => {
    expect(DEFERRED.has('video')).toBe(true);
    expect(DEFERRED.has('gif')).toBe(true);
    expect(DEFERRED.has('round')).toBe(true);
    expect(DEFERRED.has('file')).toBe(true);
    expect(DEFERRED.has('photo')).toBe(false);
  });

  it('records three visible photos with their bytes', async () => {
    const found = new Map<string, FoundItem>(), pending: PendingItem[] = [];
    const urls = [addPhoto(), addPhoto(), addPhoto()];
    await sweep(found, pending);
    expect(found.size).toBe(3);
    for (const u of urls) expect(found.get(u)?.blob?.size).toBeTruthy();
  });

  it('bytes survive revocation: fetched eagerly before the URL is revoked', async () => {
    const found = new Map<string, FoundItem>(), pending: PendingItem[] = [];
    const urls = [addPhoto(), addPhoto(), addPhoto()];
    await sweep(found, pending);
    urls.forEach(revoke);
    for (const u of urls) expect(found.get(u)?.blob?.size).toBe(2048);
  });

  it('a photo dead before harvest keeps a record with no blob, so the archive step can count it skipped', async () => {
    const found = new Map<string, FoundItem>(), pending: PendingItem[] = [];
    const dead = addPhoto();
    revoke(dead);
    await sweep(found, pending);
    expect(found.has(dead)).toBe(true);
    expect(found.get(dead)?.blob).toBeFalsy();
  });

  it('re-harvesting does not refetch an already-captured item', async () => {
    const found = new Map<string, FoundItem>(), pending: PendingItem[] = [];
    const urls = [addPhoto()];
    await sweep(found, pending);
    const before = found.get(urls[0])?.blob;
    await sweep(found, pending);
    expect(found.get(urls[0])?.blob).toBe(before);
  });
});

// A harvest runs ~8x a second for the length of the scan. Every
// getBoundingClientRect() in it forces a synchronous layout, so a per-image
// measurement is hundreds of reflows a second on a video-dense screen — which
// is what made the scroll visibly stutter. These pin the cheap paths.
describe('harvest does not force layout per element', () => {
  it('does not measure images whose decoded size already settles it', () => {
    let rects = 0;
    document.body.innerHTML = `<div class="bubbles"><div class="scrollable" style="height:100px">${
      Array.from({ length: 40 }, (_, i) =>
        `<div class="message" data-mid="${i}"><img src="blob:x${i}"></div>`).join('')
    }</div></div>`;

    for (const img of Array.from(document.querySelectorAll('img'))) {
      Object.defineProperty(img, 'naturalWidth', { value: 400 });
      img.getBoundingClientRect = () => { rects++; return new DOMRect(); };
    }
    harvest(new Map(), []);
    expect(rects).toBe(0);
  });

  it('skips an image it has already captured', () => {
    document.body.innerHTML =
      `<div class="bubbles"><div class="scrollable" style="height:100px">
         <div class="message" data-mid="1"><img src="blob:seen"></div>
       </div></div>`;
    const img = document.querySelector('img')!;
    let rects = 0;
    Object.defineProperty(img, 'naturalWidth', { value: 0 });
    img.getBoundingClientRect = () => { rects++; return new DOMRect(); };

    harvest(new Map([['blob:seen', { url: 'blob:seen', kind: 'photo' as const }]]), []);
    expect(rects).toBe(0);
  });

  it('ignores images outside the message list', () => {
    document.body.innerHTML = `
      <div class="sidebar"><img src="blob:avatar"></div>
      <div class="bubbles"><div class="scrollable" style="height:100px">
        <div class="message" data-mid="1"><img src="blob:real"></div>
      </div></div>`;
    for (const i of Array.from(document.querySelectorAll('img')))
      Object.defineProperty(i, 'naturalWidth', { value: 400 });
    const found = new Map();
    harvest(found, []);
    expect(found.has('blob:avatar')).toBe(false);
  });
});
