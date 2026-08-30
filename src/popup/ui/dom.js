// Element handles, resolved once. Every other popup module imports from here
// so no module reaches into the document on its own.
const $ = id => document.getElementById(id);

export const els = {
  scan:   $('scan'),
  stop:   $('stop'),
  more:   $('more'),
  go:     $('go'),
  types:  $('types'),
  status: $('status'),
  state:  $('state'),
  hint:   $('hint'),
};
