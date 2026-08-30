// Clicking the toolbar icon opens the side panel. MV3 has no declarative way
// to do this, so the one job of this worker is to flip the behaviour flag.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
