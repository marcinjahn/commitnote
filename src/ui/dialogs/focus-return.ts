const OPEN_NOTE_ROW = '[role="tree"] [role="treeitem"][aria-selected="true"]';
const TABBABLE_ROW = '[role="tree"] [role="treeitem"][tabindex="0"]';

export function captureFocusReturn(doc: Document = document): HTMLElement | null {
  const active = doc.activeElement;
  return active instanceof HTMLElement && active !== doc.body ? active : null;
}

function canReceiveFocus(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  if (el.matches(":disabled")) return false;
  if (el.closest("[inert], dialog:not([open])") !== null) return false;
  return el.getClientRects().length > 0;
}

export function resolveFocusTarget(
  recorded: HTMLElement | null,
  doc: Document = document,
): HTMLElement | null {
  if (canReceiveFocus(recorded)) return recorded;
  for (const selector of [OPEN_NOTE_ROW, TABBABLE_ROW]) {
    const row = doc.querySelector(selector);
    if (canReceiveFocus(row)) return row;
  }
  return null;
}

function focusIsLost(closing: Element | null, doc: Document): boolean {
  const active = doc.activeElement;
  if (active === null || active === doc.body) return true;
  return closing !== null && closing.contains(active);
}

export function returnFocus(
  recorded: HTMLElement | null,
  closing: Element | null,
  doc: Document = document,
): void {
  if (!focusIsLost(closing, doc)) return;
  resolveFocusTarget(recorded, doc)?.focus();
}
