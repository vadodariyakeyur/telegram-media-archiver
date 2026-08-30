// Shared namespace for the content-script modules.
//
// MV3 declares content_scripts as CLASSIC scripts, not ES modules, so `import`
// is unavailable here. The files listed in manifest.json share one scope per
// world and run in listed order, so each module hangs its exports on this
// object and later files read them off it. The numeric filename prefixes make
// that load order explicit on disk.
var TG = TG || {};

// --- exports ---

// Shared by nearly every module: yield to Telegram so it can render/decrypt.
TG.sleep = ms => new Promise(r => setTimeout(r, ms));

// Cancellation lives in 05-run.js: a run is a thing you hold, not a set of
// flags on this namespace. See that module for why.
