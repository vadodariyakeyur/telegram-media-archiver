// Single source of truth for how this extension is named.
//
// The repo previously carried six variants ("Telegram Chat Media Downloader",
// "Media Archiver", "telegram-media-archiver", ...). Anything that needs a
// name reads it from here, and tools/check.js fails the build if a surface
// drifts out of sync.
module.exports = {
  // Full product name: manifest, README heading, store listing.
  product: 'Telegram Media Archiver',

  // Short form. Kept as a field so callers have one name to read, but it is
  // deliberately identical to `product`: the full name measures 170px in the
  // masthead against a 288px budget, so there was never a reason to shorten
  // it, and two names for one extension only ever read as two products.
  short: 'Telegram Media Archiver',

  // npm/package + zip artifact. Lowercase, hyphenated.
  slug: 'telegram-media-archiver',

  // One sentence, used verbatim in both manifest and package.json.
  description:
    'Archives photos, videos and other media from the Telegram Web chat you have open.',
};
