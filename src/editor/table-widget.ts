import { Facet } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import { openExternal } from "../app/external-open";
import {
  containerPrefixLayout,
  type MarkdownTable,
  type MarkdownTableCell,
  type MarkdownTableRow,
  type TableAlignment,
} from "../markdown/markdown-table";
import {
  type CellImageRenderer,
  renderTableCellContent,
} from "./table-cell-content";
import { renderTableCellImage } from "./table-cell-image";
import { tableKeyDown } from "./table-selection";

type LinkOpener = (url: string) => void;

export const tableLinkOpener: Facet<LinkOpener, LinkOpener> = Facet.define<
  LinkOpener,
  LinkOpener
>({
  combine: (values) => values[0] ?? openExternal,
});

const ARMED_CLASS = "cm-link-open-armed";
const LINK_SELECTOR = ".cm-table-link[data-url]";
const observers = new WeakMap<HTMLElement, ResizeObserver>();
const destroyed = new WeakSet<HTMLElement>();

function hasModifier(event: MouseEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

function eventElement(event: Event): Element | null {
  const target = event.target;
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

function linkUrl(root: HTMLElement, event: MouseEvent): string | null {
  if (!hasModifier(event)) return null;
  const link = eventElement(event)?.closest<HTMLElement>(LINK_SELECTOR);
  return link && root.contains(link) ? (link.dataset.url ?? null) : null;
}

function nearestRow(
  root: HTMLElement,
  clientY: number,
): HTMLTableRowElement | null {
  let best: HTMLTableRowElement | null = null;
  let bestDistance = Infinity;
  for (const row of root.querySelectorAll("tr")) {
    const rect = row.getBoundingClientRect();
    const distance = Math.abs(clientY - (rect.top + rect.bottom) / 2);
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return best;
}

function placeCaret(
  view: EditorView,
  root: HTMLElement,
  event: MouseEvent,
): void {
  const element = eventElement(event);
  const target: HTMLElement | null =
    element?.closest<HTMLElement>("th, td") ?? nearestRow(root, event.clientY);
  if (!target || !root.contains(target)) return;
  let start: number;
  try {
    start = view.posAtDOM(root);
  } catch {
    return;
  }
  const pos = Math.min(
    start + Number(target.dataset.caret),
    view.state.doc.length,
  );
  view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
  view.focus();
  event.preventDefault();
}

function watchOverflow(root: HTMLElement, scroller: HTMLElement): void {
  if (typeof ResizeObserver !== "function") return;
  const table = scroller.firstElementChild;
  const update = (): void => {
    if (scroller.scrollWidth > scroller.clientWidth) {
      scroller.tabIndex = 0;
      scroller.setAttribute("role", "region");
      scroller.setAttribute("aria-label", "Table");
    } else {
      scroller.removeAttribute("tabindex");
      scroller.removeAttribute("role");
      scroller.removeAttribute("aria-label");
    }
  };
  const observer = new ResizeObserver(update);
  observer.observe(scroller);
  if (table) observer.observe(table);
  observers.set(root, observer);
  update();
}

export function tableRowTextTops(wrapper: HTMLElement): number[] {
  return Array.from(wrapper.querySelectorAll("tr"), (row) => {
    const cell = row.cells[0];
    if (!cell) return row.getBoundingClientRect().top;
    return (
      cell.getBoundingClientRect().top +
      cell.clientTop +
      (parseFloat(getComputedStyle(cell).paddingTop) || 0)
    );
  });
}

interface Caret {
  readonly node: Node;
  readonly offset: number;
}

function caretAt(doc: Document, x: number, y: number): Caret | null {
  if (typeof doc.caretPositionFromPoint === "function") {
    const position = doc.caretPositionFromPoint(x, y);
    return position && { node: position.offsetNode, offset: position.offset };
  }
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    return range && { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

// Chromium can keep collapsing a mouse drag that starts inside this
// non-editable island of the editor. Once the selection is a range, its native
// extension takes over.
function seedDragSelection(wrapper: HTMLElement, press: MouseEvent): void {
  const doc = wrapper.ownerDocument;
  const start = caretAt(doc, press.clientX, press.clientY);
  if (!start || !wrapper.contains(start.node)) return;
  const listening = new AbortController();
  const options = { capture: true, signal: listening.signal };
  doc.addEventListener(
    "mousemove",
    (event) => {
      if (!(event.buttons & 1)) {
        listening.abort();
        return;
      }
      const distance = Math.hypot(
        event.clientX - press.clientX,
        event.clientY - press.clientY,
      );
      const selection = doc.getSelection();
      if (distance <= CLICK_SLOP || !selection?.isCollapsed) return;
      const here = caretAt(doc, event.clientX, event.clientY);
      if (!here) return;
      selection.setBaseAndExtent(
        start.node,
        start.offset,
        here.node,
        here.offset,
      );
    },
    options,
  );
  doc.addEventListener("mouseup", () => listening.abort(), options);
}

const CLICK_SLOP = 4;
const LONG_PRESS_MS = 500;
const ROW_HEIGHT = 34;
const WIDGET_PADDING = 16;

export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly table: MarkdownTable,
    readonly from: number,
    readonly readOnly: boolean,
    readonly prefix: string,
  ) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source && other.readOnly === this.readOnly;
  }

  override get estimatedHeight(): number {
    return (this.table.rows.length + 1) * ROW_HEIGHT + WIDGET_PADDING;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-table-widget";

    const scroller = document.createElement("div");
    scroller.className = "cm-table-scroller";

    const table = document.createElement("table");
    table.className = "cm-table";

    const renderImage: CellImageRenderer = (image) =>
      renderTableCellImage(view, image, () => !destroyed.has(wrapper));

    const thead = document.createElement("thead");
    thead.appendChild(this.renderRow(this.table.header, "th", renderImage));
    table.appendChild(thead);

    if (this.table.rows.length > 0) {
      const tbody = document.createElement("tbody");
      for (const row of this.table.rows) {
        tbody.appendChild(this.renderRow(row, "td", renderImage));
      }
      table.appendChild(tbody);
    }

    scroller.appendChild(table);
    this.mount(wrapper, scroller);

    let press: { x: number; y: number } | null = null;
    let pointerType = "";
    let pressTime = 0;

    if (!this.readOnly) {
      wrapper.tabIndex = -1;
      wrapper.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        pointerType = event.pointerType;
        press = { x: event.clientX, y: event.clientY };
        pressTime = event.timeStamp;
      });
      wrapper.addEventListener("dragstart", (event) => event.preventDefault());
      wrapper.addEventListener("keydown", (event) => {
        let from: number;
        try {
          from = view.posAtDOM(wrapper);
        } catch {
          return;
        }
        tableKeyDown(view, event, {
          from,
          to: from + this.source.length,
          inset: this.prefix.length,
        });
      });
    }

    wrapper.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      const url = linkUrl(wrapper, event);
      if (url !== null) {
        event.preventDefault();
        view.state.facet(tableLinkOpener)(url);
        return;
      }
      if (view.state.readOnly) return;
      press = { x: event.clientX, y: event.clientY };
      if (pointerType === "touch") {
        event.preventDefault();
        return;
      }
      seedDragSelection(wrapper, event);
    });
    wrapper.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      if (linkUrl(wrapper, event) !== null) {
        event.preventDefault();
        return;
      }
      if (view.state.readOnly) return;
      const start = press;
      press = null;
      if (
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) >
          CLICK_SLOP
      ) {
        return;
      }
      if (
        pointerType === "touch" &&
        event.timeStamp - pressTime >= LONG_PRESS_MS
      ) {
        return;
      }
      placeCaret(view, wrapper, event);
    });
    wrapper.addEventListener("mousemove", (event) => {
      view.dom.classList.toggle(ARMED_CLASS, hasModifier(event));
    });

    if (this.readOnly) watchOverflow(wrapper, scroller);
    return wrapper;
  }

  private mount(wrapper: HTMLElement, scroller: HTMLElement): void {
    if (this.prefix === "") {
      wrapper.appendChild(scroller);
      return;
    }
    const { quoteLevels, indent } = containerPrefixLayout(this.prefix);
    let parent = wrapper;
    for (let level = 0; level < quoteLevels; level++) {
      const quote = document.createElement("div");
      quote.className = "cm-table-quote";
      parent.appendChild(quote);
      parent = quote;
    }
    const nest = document.createElement("div");
    nest.className = "cm-table-nest";
    if (indent !== "") {
      const span = document.createElement("span");
      span.className = "cm-table-indent";
      span.setAttribute("aria-hidden", "true");
      span.textContent = indent;
      nest.appendChild(span);
    }
    nest.appendChild(scroller);
    parent.appendChild(nest);
  }

  override destroy(dom: HTMLElement): void {
    observers.get(dom)?.disconnect();
    observers.delete(dom);
    destroyed.add(dom);
  }

  private renderRow(
    row: MarkdownTableRow,
    tag: "th" | "td",
    renderImage: CellImageRenderer,
  ): HTMLTableRowElement {
    const read = (a: number, b: number): string =>
      this.source.slice(a - this.from, b - this.from);
    const tr = document.createElement("tr");
    tr.dataset.caret = String(this.caretOffset(row.cells[0], row));
    row.cells.forEach((cell, column) => {
      const element = document.createElement(tag);
      element.dataset.caret = String(this.caretOffset(cell, row));
      if (tag === "th") element.scope = "col";
      const alignment: TableAlignment = this.table.alignments[column] ?? "";
      if (alignment) element.style.textAlign = alignment;
      if (cell.node) {
        renderTableCellContent(element, cell.node, read, renderImage);
      }
      tr.appendChild(element);
    });
    return tr;
  }

  private caretOffset(
    cell: MarkdownTableCell | undefined,
    row: MarkdownTableRow,
  ): number {
    let caret = row.to;
    if (cell?.node) {
      caret = cell.node.to;
    } else if (cell && cell.from < cell.to) {
      caret =
        this.source[cell.from - this.from] === " " ? cell.from + 1 : cell.from;
    } else if (cell) {
      caret = cell.from;
    }
    return caret - this.from;
  }
}
