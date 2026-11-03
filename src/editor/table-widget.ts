import { Facet } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import { openExternal } from "../app/external-open";
import type {
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableRow,
  TableAlignment,
} from "../markdown/markdown-table";
import { renderTableCellContent } from "./table-cell-content";

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

const ROW_HEIGHT = 34;
const WIDGET_PADDING = 16;

export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly table: MarkdownTable,
    readonly from: number,
    readonly readOnly: boolean,
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

    const thead = document.createElement("thead");
    thead.appendChild(this.renderRow(this.table.header, "th"));
    table.appendChild(thead);

    if (this.table.rows.length > 0) {
      const tbody = document.createElement("tbody");
      for (const row of this.table.rows) {
        tbody.appendChild(this.renderRow(row, "td"));
      }
      table.appendChild(tbody);
    }

    scroller.appendChild(table);
    wrapper.appendChild(scroller);

    wrapper.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      const url = linkUrl(wrapper, event);
      if (url !== null) {
        event.preventDefault();
        view.state.facet(tableLinkOpener)(url);
      } else if (!view.state.readOnly) {
        event.preventDefault();
      }
    });
    wrapper.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      if (linkUrl(wrapper, event) !== null) {
        event.preventDefault();
        return;
      }
      if (view.state.readOnly) return;
      placeCaret(view, wrapper, event);
    });
    wrapper.addEventListener("mousemove", (event) => {
      view.dom.classList.toggle(ARMED_CLASS, hasModifier(event));
    });

    if (this.readOnly) watchOverflow(wrapper, scroller);
    return wrapper;
  }

  override destroy(dom: HTMLElement): void {
    observers.get(dom)?.disconnect();
    observers.delete(dom);
  }

  private renderRow(
    row: MarkdownTableRow,
    tag: "th" | "td",
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
      if (cell.node) renderTableCellContent(element, cell.node, read);
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
