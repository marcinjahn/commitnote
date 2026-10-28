import type { Text } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";

export interface TableRange {
  readonly from: number;
  readonly to: number;
  readonly inset: number;
}

const MODIFIER_KEYS = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Fn",
  "FnLock",
  "Hyper",
  "Meta",
  "NumLock",
  "OS",
  "ScrollLock",
  "Shift",
  "Super",
  "Symbol",
  "SymbolLock",
]);

const ARROW_FORWARD: Readonly<Record<string, boolean>> = {
  ArrowUp: false,
  ArrowLeft: false,
  ArrowDown: true,
  ArrowRight: true,
};

function isCopyShortcut(event: KeyboardEvent): boolean {
  if (event.altKey) return false;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
    return true;
  }
  return event.ctrlKey && event.key === "Insert";
}

function hasModifier(event: KeyboardEvent): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
}

function besideTable(doc: Text, table: TableRange, forward: boolean): number {
  if (forward) {
    return table.to < doc.length ? doc.lineAt(table.to + 1).from : table.to;
  }
  return table.from > 0
    ? doc.lineAt(table.from - 1).to
    : Math.min(table.from + table.inset, table.to);
}

function replay(view: EditorView, event: KeyboardEvent): void {
  const copy = new KeyboardEvent("keydown", {
    key: event.key,
    code: event.code,
    location: event.location,
    repeat: event.repeat,
    isComposing: event.isComposing,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    keyCode: event.keyCode,
    charCode: event.charCode,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  view.contentDOM.dispatchEvent(copy);
  event.stopPropagation();
  if (copy.defaultPrevented) event.preventDefault();
}

// A drag selection inside a rendered table leaves focus on the table wrapper,
// where CodeMirror ignores key events. Hands the key to the editor at its
// unchanged selection; text input from an unhandled key follows the focus.
export function tableKeyDown(
  view: EditorView,
  event: KeyboardEvent,
  table: TableRange,
): void {
  if (view.state.readOnly) return;
  if (MODIFIER_KEYS.has(event.key) || isCopyShortcut(event)) return;
  const forward = ARROW_FORWARD[event.key];
  if (forward !== undefined && !hasModifier(event)) {
    event.preventDefault();
    view.dispatch({
      selection: { anchor: besideTable(view.state.doc, table, forward) },
      scrollIntoView: true,
      userEvent: "select",
    });
    view.focus();
    return;
  }
  view.focus();
  if (!event.defaultPrevented) replay(view, event);
}

function closestTable(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest("table.cm-table") ?? null;
}

function isAfter(table: Element, node: Node, offset: number): boolean {
  const start = table.ownerDocument.createRange();
  start.setStart(table, 0);
  return start.comparePoint(node, offset) > 0;
}

function cellText(cell: Element, range: Range): string {
  const clipped = cell.ownerDocument.createRange();
  clipped.selectNodeContents(cell);
  if (cell.contains(range.startContainer)) {
    clipped.setStart(range.startContainer, range.startOffset);
  }
  if (cell.contains(range.endContainer)) {
    clipped.setEnd(range.endContainer, range.endOffset);
  }
  const fragment = clipped.cloneContents();
  for (const image of fragment.querySelectorAll(".cm-table-image")) {
    const alt = image.querySelector("img")?.getAttribute("alt") ?? "";
    image.replaceWith(cell.ownerDocument.createTextNode(alt));
  }
  return (fragment.textContent ?? "").replace(/[\t\r\n]/g, " ");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function tableSelectionClipboard(
  table: HTMLTableElement,
  range: Range,
): { text: string; html: string } | null {
  const rows: Array<Array<{ tag: string; text: string }>> = [];
  let count = 0;
  for (const row of table.rows) {
    const cells: Array<{ tag: string; text: string }> = [];
    for (const cell of row.cells) {
      if (!range.intersectsNode(cell)) continue;
      cells.push({ tag: cell.localName, text: cellText(cell, range) });
    }
    if (cells.length > 0) rows.push(cells);
    count += cells.length;
  }
  if (count < 2) return null;
  const text = rows
    .map((cells) => cells.map((c) => c.text).join("\t"))
    .join("\n");
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells
          .map((c) => `<${c.tag}>${escapeHtml(c.text)}</${c.tag}>`)
          .join("")}</tr>`,
    )
    .join("");
  return { text, html: `<table>${body}</table>` };
}

class TableSelection {
  private readonly onSelectionChange = (): void => this.check();

  private readonly onCopy = (event: ClipboardEvent): void => {
    const { view } = this;
    const root = view.root as { getSelection?: () => Selection | null };
    const selection =
      root.getSelection?.() ?? view.dom.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
      return;
    }
    const range = selection.getRangeAt(0);
    const table = closestTable(range.startContainer);
    if (
      !table ||
      !view.contentDOM.contains(table) ||
      !table.contains(range.endContainer) ||
      closestTable(range.endContainer) !== table
    ) {
      return;
    }
    const data = event.clipboardData;
    const copied = tableSelectionClipboard(table as HTMLTableElement, range);
    if (!data || !copied) return;
    data.setData("text/plain", copied.text);
    data.setData("text/html", copied.html);
    event.preventDefault();
  };

  constructor(private readonly view: EditorView) {
    view.dom.ownerDocument.addEventListener(
      "selectionchange",
      this.onSelectionChange,
    );
    view.contentDOM.addEventListener("copy", this.onCopy, { capture: true });
  }

  private check(): void {
    const { view } = this;
    if (view.state.readOnly) return;
    const selection = view.dom.ownerDocument.getSelection();
    const anchor = selection?.anchorNode;
    if (!selection || !anchor) return;
    const table = closestTable(anchor);
    if (!table || !view.contentDOM.contains(table)) return;
    const focus = selection.focusNode;
    if (focus && !table.contains(focus)) {
      const end = isAfter(table, focus, selection.focusOffset)
        ? table.childNodes.length
        : 0;
      selection.setBaseAndExtent(anchor, selection.anchorOffset, table, end);
    }
    if (selection.isCollapsed) return;
    if (view.root.activeElement !== view.contentDOM) return;
    const wrapper = table.closest<HTMLElement>(".cm-table-widget");
    if (!wrapper) return;
    const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
    wrapper.focus({ preventScroll: true });
    if (
      anchorNode &&
      focusNode &&
      (selection.anchorNode !== anchorNode ||
        selection.anchorOffset !== anchorOffset ||
        selection.focusNode !== focusNode ||
        selection.focusOffset !== focusOffset)
    ) {
      selection.setBaseAndExtent(
        anchorNode,
        anchorOffset,
        focusNode,
        focusOffset,
      );
    }
  }

  destroy(): void {
    this.view.dom.ownerDocument.removeEventListener(
      "selectionchange",
      this.onSelectionChange,
    );
    this.view.contentDOM.removeEventListener("copy", this.onCopy, {
      capture: true,
    });
  }
}

export const tableSelection = ViewPlugin.fromClass(TableSelection);
