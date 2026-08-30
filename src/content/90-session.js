// The session: what has been scanned, and what may legally follow.
//
// These rules used to be guard clauses interleaved with message plumbing in
// 99-main.js, which exported nothing — so exercising them meant faking the
// extension messaging layer, and nobody did. A stale scan surviving a chat
// switch was a real bug, fixed twice.
//
// Nothing here touches chrome.* or the DOM.

class Session {
  constructor() {
    this.scan = null;      // last scan result, reused by CONTINUE and DOWNLOAD
    this.chatKey = null;   // the chat that scan belongs to
  }

  record(scan, chatKey) {
    this.scan = scan;
    this.chatKey = chatKey;
    return this;
  }

  clear() {
    this.scan = null;
    this.chatKey = null;
  }

  // Telegram never reloads the page on a chat switch, so a scan taken in one
  // chat would otherwise still be sitting here: the panel would show the
  // previous chat's manifest, and a download would act on its captured nodes.
  invalidateIfChatChanged(nowKey) {
    if (this.chatKey !== null && nowKey !== this.chatKey) {
      this.clear();
      return true;
    }
    return false;
  }

  get hasScan() { return this.scan !== null; }

  // A stopped scan can be resumed, unless it already reached the top — the
  // continue would scroll into nothing.
  get canContinue() { return !!this.scan?.stopped && !this.scan.exhausted; }

  // The counts a stopped scan reached are a floor, not a total.
  get isPartial() { return !!this.scan?.stopped; }

  // Returning the reason rather than a bare false keeps the message the user
  // sees next to the rule that produced it.
  refuseContinue() {
    if (!this.scan?.stopped) return 'Nothing to continue.';
    if (this.scan.exhausted) return 'Already at the top of the chat.';
    return null;
  }

  refuseDownload(kinds) {
    if (!this.hasScan) return 'Scan first.';
    if (!kinds?.length) return 'Nothing selected.';
    return null;
  }

  itemsFor(kinds) {
    if (!this.scan) return [];
    return [...this.scan.found.values()].filter(it => kinds.includes(it.kind));
  }
}

// --- exports ---
TG.Session = Session;
