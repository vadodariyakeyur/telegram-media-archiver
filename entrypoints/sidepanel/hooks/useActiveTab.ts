// Was ui/tabs.js. Kept as a fresh per-call lookup, not cached state: the
// panel can stay open across a tab/window switch, and every send needs
// whichever tab is active right now, not whichever was active at mount.
export async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url?.startsWith('https://web.telegram.org/') ? tab : null;
}
