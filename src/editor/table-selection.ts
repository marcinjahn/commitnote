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

class TableSelection {
  private readonly onSelectionChange = (): void => this.check();

  constructor(private readonly view: EditorView) {
    view.dom.ownerDocument.addEventListener(
      "selectionchange",
      this.onSelectionChange,
    );
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
  }
}

export const tableSelection = ViewPlugin.fromClass(TableSelection);
