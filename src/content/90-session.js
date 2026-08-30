// The session: what has been scanned, and what may legally follow.
//
// These rules used to live as guard clauses interleaved with message plumbing
// in 99-main.js, which exported nothing — so the only way to exercise them was
// to fake the extension messaging layer, and nobody did. A stale scan
// surviving a chat switch was a real bug, fixed twice, and still asserted only
// indirectly by a test that re-implemented the guard rather than calling it.
//
// Nothing here touches chrome.* or the DOM. It is a plain object holding the
// last scan and answering questions about it.

class Session {
  constructor() {
    this.scan = null;      // last scan result, reused by CONTINUE and DOWNLOAD
    this.chatKey = null;   // the chat that scan belongs to
  }

  // Record a finished (or stopped) scan pass as belonging to `chatKey`.
  record(scan, chatKey) {
    this.scan = scan;
    this.chatKey = chatKey;
    return this;
  }

  // Forget everything. Used when the scan is no longer trustworthy.
  clear() {
    this.scan = null;
    this.chatKey = null;
  }

  // Telegram never reloads the page when you switch chats, so a scan taken in
  // one chat would otherwise still be sitting here: the popup would show the
  // previous chat's manifest, and a download would act on its captured nodes.
  //
  // Returns true when a switch was detected and the scan dropped.
  invalidateIfChatChanged(nowKey) {
    if (this.chatKey !== null && nowKey !== this.chatKey) {
      this.clear();
      return true;
    }
    return false;
  }

  // Is there a scan to act on at all?
  get hasScan() { return this.scan !== null; }

  // A stopped scan can be resumed, unless it already reached the top of the
  // chat — continuing then would scroll into nothing.
  get canContinue() { return !!this.scan?.stopped && !this.scan.exhausted; }

  // The counts a stopped scan reached are a floor, not a total.
  get isPartial() { return !!this.scan?.stopped; }

  // Why a CONTINUE would be refused, or null if it is legal. Returning the
  // reason rather than a bare false keeps the message the user sees next to
  // the rule that produced it.
  refuseContinue() {
    if (!this.scan?.stopped) return 'Nothing to continue.';
    if (this.scan.exhausted) return 'Already at the top of the chat.';
    return null;
  }

  // Why a DOWNLOAD would be refused, or null if it is legal.
  refuseDownload(kinds) {
    if (!this.hasScan) return 'Scan first.';
    if (!kinds?.length) return 'Nothing selected.';
    return null;
  }

  // The media of the selected kinds, ready to archive.
  itemsFor(kinds) {
    if (!this.scan) return [];
    return [...this.scan.found.values()].filter(it => kinds.includes(it.kind));
  }
}

// --- exports ---
TG.Session = Session;
