// Self-check for bubble classification against markup shaped like both the
// /k/ and /a/ clients. Catches the regressions that kept losing videos.
import { describe, it, expect } from 'vitest';
import { classify } from '../tw-sdk/classify';

const make = (html: string) => {
  const d = document.createElement('div');
  d.className = 'bubble';
  d.innerHTML = html;
  return d;
};
const img = () => document.createElement('img'); // stand-in for "a thumbnail is present"

const cases: [string, string, boolean, string | null][] = [
  ['video w/ duration badge (/k/)', '<div class="media-container"><span>0:42</span></div>', true, 'video'],
  ['video w/ hh:mm:ss badge', '<div><span>1:02:33</span></div>', true, 'video'],
  ['video by class (/a/)', '<div class="media-video"></div>', true, 'video'],
  // Round notes and GIFs used to fold into video. They are their own kinds now,
  // and both must be checked BEFORE video, which would otherwise swallow them.
  ['round video note', '<div class="is-round"></div>', true, 'round'],
  ['round note beats duration', '<div class="video-note"><span>0:12</span></div>', true, 'round'],
  ['gif is its own kind', '<div class="media-gif"></div>', true, 'gif'],
  ['gif beats duration badge', '<div class="media-gif"><span>0:03</span></div>', true, 'gif'],
  ['plain photo', '<div class="media-photo"></div>', true, 'photo'],
  ['photo w/ caption text', '<div class="text-content">hello there</div>', true, 'photo'],
  ['sticker', '<div class="sticker-wrapper"></div>', true, 'sticker'],
  ['voice by <audio>', '<audio></audio>', false, 'voice'],
  ['voice by waveform class', '<div class="waveform"></div>', false, 'voice'],
  // An uploaded track carries a title row; a recorded note carries a waveform.
  // Both are <audio>, so the markup is the only thing separating them.
  ['music by title row', '<audio></audio><div class="audio-title">Song</div>', false, 'music'],
  ['document, no thumb', '<div class="document"><span class="file-name">a.pdf</span></div>', false, 'file'],
  // A document checked last, not first: this bubble has a thumbnail AND an
  // attachment, and the earlier branches must not have claimed it as a photo.
  ['document with a thumbnail', '<div class="document"><span class="document-name">a.zip</span></div>', true, 'file'],
  ['text only -> nothing', '<div class="text-content">just text</div>', false, null],
];

describe('classify', () => {
  it.each(cases)('%s', (_name, html, hasImg, want) => {
    expect(classify(make(html), hasImg ? img() : null)).toBe(want);
  });

  // A timestamp in a caption must not turn a photo into a video: the badge check
  // only fires on leaf nodes, but a bare leaf caption is genuinely ambiguous.
  it('caption "meet at 5:30" is not misread as a video duration badge', () => {
    const t = classify(make('<div class="text-content"><span>meet at 5:30</span></div>'), img());
    expect(t).not.toBe('video');
  });
});
