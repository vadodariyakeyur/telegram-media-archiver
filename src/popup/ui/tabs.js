// Resolving the Telegram tab this popup acts on.
// Every action is scoped to it, so the guard lives in one place.

export const activeTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url?.startsWith('https://web.telegram.org/') ? tab : null;
};

// Selected types, and the download button's enabled state, both derive from
// the checkboxes — so read them rather than tracking a parallel copy.
