// The popup borrows Telegram's live theme rather than hardcoding a palette,
// because a hardcoded one is wrong for anyone running a custom accent. The
// reader must handle both clients' property names, degrade to the shipped
// defaults when nothing is readable, and never emit an unreadable pairing.
const assert = require('assert');

const ROOT = require('path').join(__dirname, '..');
const read = p => require('fs').readFileSync(require('path').join(ROOT, p), 'utf8');

const src = read('src/content/15-theme.js');
// Evaluate the module body in its own scope and hand back what is tested.
const load = (props = {}, sheetNames = []) => {
  const doc = {
    documentElement: {},
    styleSheets: [{ cssRules: sheetNames.map(n => ({
      selectorText: ':root', style: Object.assign([n], { length: 1 }),
    })) }],
  };
  const getComputedStyle = () => ({
    getPropertyValue: n => props[n] ?? '',
  });
  return new Function('document', 'getComputedStyle', 'TG',
    src.replace(/^\/\/ --- exports ---[\s\S]*$/m, '') +
    '\nreturn { readTheme, contrast, isDark, toRgb, lighten, bestOn, isColor };'
  )(doc, getComputedStyle, {});
};

// --- /k/ client names ------------------------------------------------------
let t = load({
  '--background-color': '#0E0E0E',
  '--primary-color': '#8675DC',
  '--primary-text-color': '#FFFFFF',
  '--secondary-text-color': '#8D8D8F',
  '--border-color': '#2B2B2C',
}).readTheme();
assert.ok(t, 'reads a /k/ theme');
assert.strictEqual(t.vault, '#0E0E0E', 'background mapped');
assert.strictEqual(t.signal, '#8675DC', 'accent mapped');
assert.strictEqual(t.dark, true, 'a near-black ground is detected as dark');
assert.ok(t.hover, 'a hover shade is derived from the accent');
assert.strictEqual(t.onblue, '#FFFFFF', 'white reads better on this violet');

// --- /a/ client names ------------------------------------------------------
t = load({
  '--color-background': '#FFFFFF',
  '--color-primary': '#3390EC',
  '--color-text': '#000000',
  '--color-text-secondary': '#707579',
}).readTheme();
assert.strictEqual(t.vault, '#FFFFFF', '/a/ background mapped');
assert.strictEqual(t.signal, '#3390EC', '/a/ accent mapped');
assert.strictEqual(t.dark, false, 'a white ground is detected as light');

// --- nothing readable -> null, so the popup keeps its own palette ----------
assert.strictEqual(load({}).readTheme(), null, 'an empty page yields no theme');
assert.strictEqual(load({ '--unrelated': '12px' }).readTheme(), null,
  'non-colour properties do not count as a theme');

// --- junk values are rejected, not passed through --------------------------
const api = load({});
assert.ok(!api.isColor('none'), 'none rejected');
assert.ok(!api.isColor('transparent'), 'transparent rejected');
assert.ok(!api.isColor('linear-gradient(red, blue)'), 'gradients rejected');
assert.ok(!api.isColor('rgba(0, 0, 0, 0.1)'), 'near-transparent rejected');
assert.ok(api.isColor('#fff'), 'short hex accepted');
assert.ok(api.isColor('rgb(1, 2, 3)'), 'rgb accepted');

// A page exposing only a transparent background must not half-apply.
assert.strictEqual(load({ '--background-color': 'transparent' }).readTheme(), null,
  'a transparent-only theme is rejected outright');

// --- parsing --------------------------------------------------------------
assert.deepStrictEqual(api.toRgb('#fff'), [255, 255, 255], '#rgb expands');
assert.deepStrictEqual(api.toRgb('#0E0E0E'), [14, 14, 14], '#rrggbb parsed');
assert.deepStrictEqual(api.toRgb('rgb(134, 117, 220)'), [134, 117, 220], 'rgb() parsed');
assert.deepStrictEqual(api.toRgb('rgba(1, 2, 3, 0.9)'), [1, 2, 3], 'rgba() parsed');
assert.strictEqual(api.toRgb('nonsense'), null, 'garbage yields null');

// --- foreground choice is by contrast, not assumption ----------------------
assert.strictEqual(api.bestOn('#0E0E0E'), '#FFFFFF', 'white on near-black');
assert.strictEqual(api.bestOn('#FFFFFF'), '#000000', 'black on white');
assert.strictEqual(api.bestOn('#FFE066'), '#000000', 'black on a pale accent');
assert.strictEqual(api.bestOn('#6FE0C0'), '#000000', 'black on mint');
assert.ok(api.contrast('#FFFFFF', '#0E0E0E') > 15, 'contrast maths is sane');

// The rule is NOT "whichever ratio is higher". On a mid-tone accent black
// often wins on ratio yet looks wrong, and every client puts white there.
// These two would flip to black under a naive max-contrast rule.
assert.ok(api.contrast('#000000', '#8675DC') > api.contrast('#FFFFFF', '#8675DC'),
  'black really does have the higher ratio on this violet');
assert.strictEqual(api.bestOn('#8675DC'), '#FFFFFF',
  'white is still chosen: matches Telegram, and black looks wrong on an accent');
assert.strictEqual(api.bestOn('#3390EC'), '#FFFFFF', 'same for Telegram blue');

// --- a partial theme keeps only what it resolved ---------------------------
t = load({ '--primary-color': '#8675DC' }).readTheme();
assert.ok(t, 'an accent alone is still a usable theme');
assert.strictEqual(t.signal, '#8675DC', 'the accent came through');
assert.ok(!t.ink, 'unresolved tokens are omitted, not blanked');

console.log('all 26 theme checks pass');
