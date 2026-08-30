// Self-check for bubble classification against markup shaped like both the
// /k/ and /a/ clients. Catches the regressions that kept losing videos.
const assert = require('assert');
const { JSDOM } = (() => { try { return require('jsdom'); } catch { return {}; } })();
if (!JSDOM) { console.log('skip: jsdom not installed'); process.exit(0); }

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');
const src = read('src/content/10-dom.js') + '\n' + read('src/content/20-classify.js');
const grab = n => src.slice(src.indexOf(`function ${n}(`), src.indexOf('\n}\n', src.indexOf(`function ${n}(`)) + 2);
const dom = new JSDOM('<body></body>');
global.document = dom.window.document;
// Modules reference siblings via the TG namespace; the eval'd copies
// are bare functions, so point TG at the same global scope.
global.TG = global;

eval(grab('durationIn') + grab('classify'));

const make = html => {
  const d = dom.window.document.createElement('div');
  d.className = 'bubble';
  d.innerHTML = html;
  return d;
};
const img = () => ({});   // stand-in for "a thumbnail is present"

const cases = [
  // [name, html, hasImg, expected]
  ['video w/ duration badge (/k/)', '<div class="media-container"><span>0:42</span></div>', 1, 'video'],
  ['video w/ hh:mm:ss badge',       '<div><span>1:02:33</span></div>', 1, 'video'],
  ['video by class (/a/)',          '<div class="media-video"></div>', 1, 'video'],
  // Round notes and GIFs used to fold into video. They are their own kinds now,
  // and both must be checked BEFORE video, which would otherwise swallow them.
  ['round video note',              '<div class="is-round"></div>', 1, 'round'],
  ['round note beats duration',     '<div class="video-note"><span>0:12</span></div>', 1, 'round'],
  ['gif is its own kind',           '<div class="media-gif"></div>', 1, 'gif'],
  ['gif beats duration badge',      '<div class="media-gif"><span>0:03</span></div>', 1, 'gif'],
  ['plain photo',                   '<div class="media-photo"></div>', 1, 'photo'],
  ['photo w/ caption text',         '<div class="text-content">hello there</div>', 1, 'photo'],
  ['sticker',                       '<div class="sticker-wrapper"></div>', 1, 'sticker'],
  ['voice by <audio>',              '<audio></audio>', 0, 'voice'],
  ['voice by waveform class',       '<div class="waveform"></div>', 0, 'voice'],
  // An uploaded track carries a title row; a recorded note carries a waveform.
  // Both are <audio>, so the markup is the only thing separating them.
  ['music by title row',            '<audio></audio><div class="audio-title">Song</div>', 0, 'music'],
  ['document, no thumb',            '<div class="document"><span class="file-name">a.pdf</span></div>', 0, 'file'],
  // A document checked last, not first: this bubble has a thumbnail AND an
  // attachment, and the earlier branches must not have claimed it as a photo.
  ['document with a thumbnail',     '<div class="document"><span class="document-name">a.zip</span></div>', 1, 'file'],
  ['text only -> nothing',          '<div class="text-content">just text</div>', 0, null],
];

let bad = 0;
for (const [name, html, hasImg, want] of cases) {
  const got = classify(make(html), hasImg ? img() : null);
  if (got !== want) { bad++; console.log(`FAIL ${name}: got ${got}, want ${want}`); }
}

// A timestamp in a caption must not turn a photo into a video: the badge check
// only fires on leaf nodes, but a bare leaf caption is genuinely ambiguous.
const t = classify(make('<div class="text-content"><span>meet at 5:30</span></div>'), img());
if (t === 'video') { bad++; console.log('FAIL: caption "meet at 5:30" misread as video'); }

console.log(bad ? `${bad} failed` : `all ${cases.length + 1} classify cases pass`);
process.exit(bad ? 1 : 0);
