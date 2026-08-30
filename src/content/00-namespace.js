// MV3 content scripts are CLASSIC scripts, not ES modules — no `import` here.
// Files share one scope per world and run in manifest order; the numeric
// filename prefixes make that order explicit.
var TG = TG || {};

// --- exports ---
TG.sleep = ms => new Promise(r => setTimeout(r, ms));
