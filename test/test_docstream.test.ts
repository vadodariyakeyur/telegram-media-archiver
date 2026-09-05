// Building a document's /stream/ URL from its row.
//
// Every constant here was established empirically against a live service
// worker: raw JSON not base64, a nested `location` wrapper, and `size`
// mandatory. Each has a failing-SW signature if broken.
import { describe, it, expect } from 'vitest';
import { docNameIn, docSizeIn, docStreamUrl } from '../tw-sdk/classify';

const row = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

// The real markup, from the probe.
const REAL = `<div class="document ext-mkv" data-doc-id="5979052611603535768">
  <div class="document-name"><middle-ellipsis-element title="[@Anime_RTX] [S02-E12] Solo Leveling [HDRIP] [Sub].mkv">[@Anime_RTX] [S…RIP] [Sub].mkv</middle-ellipsis-element></div>
  <div class="document-size"><span><span class="i18n">1.35 GB</span> · <span> / <span class="i18n">1.35 GB</span></span></span></div>
</div>`;

describe('docNameIn', () => {
  // The displayed text is middle-ellipsised; the title holds the real name. A
  // literal "…" in a filename is the symptom of reading textContent.
  it('the full name comes from the title attribute, not the ellipsised text', () => {
    const name = docNameIn(row(REAL));
    expect(name).toBe('[@Anime_RTX] [S02-E12] Solo Leveling [HDRIP] [Sub].mkv');
    expect(name).not.toContain('…');
  });

  it('falls back to plain text when no title attribute exists', () => {
    expect(docNameIn(row('<div class="document-name">notes.txt</div>'))).toBe('notes.txt');
  });
});

describe('docSizeIn', () => {
  it('1.35 GB parses to bytes', () => {
    expect(docSizeIn(row(REAL))).toBe(1350000000);
  });
  it('KB', () => {
    expect(docSizeIn(row('<div class="document-size">42 KB</div>'))).toBe(42000);
  });
  it('bytes', () => {
    expect(docSizeIn(row('<div class="document-size">7 B</div>'))).toBe(7);
  });
  // Rounded up: an under-estimate truncates the download, an over-estimate is
  // corrected by the server's Content-Range.
  it('MB, rounded up on a fraction', () => {
    expect(docSizeIn(row('<div class="document-size">1.5 MB</div>'))).toBe(1500000);
  });
  it('unparsable size yields null', () => {
    expect(docSizeIn(row('<div class="document-size">no size here</div>'))).toBe(null);
  });
});

describe('docStreamUrl', () => {
  it('builds a /stream/ URL under the page origin, with a RAW (non-base64) JSON query', () => {
    const url = docStreamUrl(row(REAL));
    expect(url).toBeTruthy();
    expect(url!.startsWith(`${location.origin}/stream/`)).toBe(true);

    const json = decodeURIComponent(url!.slice(url!.indexOf('/stream/') + 8));
    // RAW json, not base64: the worker JSON.parse's the path directly and
    // throws "Unexpected token 'e'" on a base64 string.
    const p = JSON.parse(json);
    expect(p.location._).toBe('inputDocumentFileLocation');
    // A BARE location (no wrapper) crashed the worker at getDocId reading .id
    // of undefined, so the nesting is load-bearing.
    expect(p.location.id).toBe('5979052611603535768');
    expect(p.size).toBe(1350000000);
    expect('dcId' in p).toBe(true); // value ignored by the worker, field is not
    expect(p.fileName).toBe('[@Anime_RTX] [S02-E12] Solo Leveling [HDRIP] [Sub].mkv');
  });

  it('missing either input means no URL rather than one the worker will reject', () => {
    expect(docStreamUrl(row('<div class="document-size">1 GB</div>'))).toBe(null); // no doc-id
    expect(docStreamUrl(row('<div data-doc-id="123"></div>'))).toBe(null); // no size
  });
});
