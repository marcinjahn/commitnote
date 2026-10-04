import { markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode, Tree } from "@lezer/common";
import { toOpenableUrl } from "./link-open";

const SKIPPED_INLINE = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "LinkMark",
  "HeaderMark",
  "QuoteMark",
  "TaskMarker",
]);

const ATX_HEADING = /^ATXHeading([1-6])$/;
const SETEXT_HEADING = /^SetextHeading([12])$/;

interface RenderContext {
  readonly text: string;
  readonly doc: Document;
  readonly refs: ReadonlyMap<string, string>;
  lineStart: boolean;
}

interface LinkParts {
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly hasDestination: boolean;
  readonly destination: SyntaxNode | null;
  readonly label: SyntaxNode | null;
}

function parse(text: string): Tree {
  return markdownLanguage.parser.parse(text);
}

function isHeading(name: string): boolean {
  return ATX_HEADING.test(name) || SETEXT_HEADING.test(name);
}

function trimRange(text: string, from: number, to: number): [number, number] {
  while (from < to && /\s/.test(text[from])) from++;
  while (to > from && /\s/.test(text[to - 1])) to--;
  return [from, to];
}

function headingRange(text: string, node: SyntaxNode): [number, number] {
  let from = node.from;
  let to = node.to;
  const first = node.firstChild;
  const last = node.lastChild;
  if (ATX_HEADING.test(node.name)) {
    if (first?.name === "HeaderMark") from = first.to;
    if (last && last.from > (first?.from ?? -1) && last.name === "HeaderMark")
      to = last.from;
  } else if (last?.name === "HeaderMark") {
    to = last.from;
  }
  return trimRange(text, from, to);
}

function stripAngles(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeLabel(label: string): string {
  return label
    .replace(/^\[|\]$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function linkParts(text: string, node: SyntaxNode): LinkParts {
  const opening = node.firstChild;
  let contentTo = node.to;
  let hasDestination = false;
  let destination: SyntaxNode | null = null;
  let label: SyntaxNode | null = null;
  let closed = false;
  for (
    let child = opening?.nextSibling ?? null;
    child;
    child = child.nextSibling
  ) {
    if (child.name === "LinkMark") {
      const mark = text.slice(child.from, child.to);
      if (mark === "]" && !closed) {
        contentTo = child.from;
        closed = true;
      } else if (mark === "(") {
        hasDestination = true;
      }
    } else if (child.name === "URL" && closed) {
      destination = child;
    } else if (child.name === "LinkLabel") {
      label = child;
    }
  }
  return {
    contentFrom: opening?.to ?? node.from,
    contentTo,
    hasDestination,
    destination,
    label,
  };
}

function linkUrl(
  text: string,
  refs: ReadonlyMap<string, string>,
  parts: LinkParts,
): string | null {
  if (parts.hasDestination) {
    return parts.destination
      ? stripAngles(text.slice(parts.destination.from, parts.destination.to))
      : "";
  }
  const label = parts.label && text.slice(parts.label.from, parts.label.to);
  const key = normalizeLabel(
    label && label !== "[]"
      ? label
      : text.slice(parts.contentFrom, parts.contentTo),
  );
  return refs.get(key) ?? null;
}

// The lezer markdown parser does not resolve reference links, so definitions
// are collected up front and looked up by normalised label.
function collectReferences(text: string, tree: Tree): Map<string, string> {
  const refs = new Map<string, string>();
  tree.iterate({
    enter: (ref) => {
      if (ref.name === "Paragraph" || isHeading(ref.name)) return false;
      if (ref.name !== "LinkReference") return undefined;
      const label = ref.node.getChild("LinkLabel");
      const url = ref.node.getChild("URL");
      if (label && url) {
        const key = normalizeLabel(text.slice(label.from, label.to));
        if (!refs.has(key))
          refs.set(key, stripAngles(text.slice(url.from, url.to)));
      }
      return false;
    },
  });
  return refs;
}

function inlineCodeText(text: string, node: SyntaxNode): string {
  const marks = node.getChildren("CodeMark");
  const from = marks[0]?.to ?? node.from;
  const to = marks.length > 1 ? marks[marks.length - 1].from : node.to;
  return text.slice(from, to).replace(/\n[ \t]*/g, " ");
}

function plainText(
  text: string,
  node: SyntaxNode,
  from: number,
  to: number,
): string {
  let out = "";
  let pos = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    if (child.from > pos) out += text.slice(pos, child.from);
    out += plainInline(text, child);
    pos = Math.max(pos, child.to);
  }
  if (pos < to) out += text.slice(pos, to);
  return out;
}

function plainInline(text: string, node: SyntaxNode): string {
  if (SKIPPED_INLINE.has(node.name)) return "";
  switch (node.name) {
    case "Link":
    case "Image": {
      const parts = linkParts(text, node);
      return plainText(text, node, parts.contentFrom, parts.contentTo);
    }
    case "InlineCode":
      return inlineCodeText(text, node);
    case "Escape":
      return text.slice(node.from + 1, node.to);
    case "HardBreak":
      return "\n";
    default:
      return plainText(text, node, node.from, node.to);
  }
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function showsPrintTitle(name: string, text: string): boolean {
  const wanted = normalizeTitle(name);
  if (!wanted) return false;
  const first = parse(text).topNode.firstChild;
  if (!first || !isHeading(first.name)) return true;
  const [from, to] = headingRange(text, first);
  return normalizeTitle(plainText(text, first, from, to)) !== wanted;
}

function emitText(ctx: RenderContext, parent: Node, value: string): void {
  const lines = value.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) {
      parent.appendChild(ctx.doc.createElement("br"));
      ctx.lineStart = true;
    }
    let part = index < lines.length - 1 ? line.replace(/[ \t]+$/, "") : line;
    if (ctx.lineStart) part = part.replace(/^[ \t]+/, "");
    if (part) {
      parent.appendChild(ctx.doc.createTextNode(part));
      ctx.lineStart = false;
    }
  });
}

function renderInlineRange(
  ctx: RenderContext,
  parent: Node,
  node: SyntaxNode,
  from: number,
  to: number,
): void {
  let pos = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    if (child.from > pos)
      emitText(ctx, parent, ctx.text.slice(pos, child.from));
    if (!SKIPPED_INLINE.has(child.name)) renderInline(ctx, parent, child);
    pos = Math.max(pos, child.to);
  }
  if (pos < to) emitText(ctx, parent, ctx.text.slice(pos, to));
}

function appendElement<K extends keyof HTMLElementTagNameMap>(
  ctx: RenderContext,
  parent: Node,
  tag: K,
): HTMLElementTagNameMap[K] {
  const element = ctx.doc.createElement(tag);
  parent.appendChild(element);
  return element;
}

function appendUrlSuffix(ctx: RenderContext, parent: Node, url: string): void {
  const suffix = appendElement(ctx, parent, "span");
  suffix.className = "print-url";
  suffix.textContent = ` (${url})`;
}

function renderUrl(ctx: RenderContext, parent: Node, node: SyntaxNode): void {
  const written = ctx.text.slice(node.from, node.to);
  const openable = toOpenableUrl(written.trim());
  if (openable === null) {
    emitText(ctx, parent, written);
    return;
  }
  const anchor = appendElement(ctx, parent, "a");
  anchor.setAttribute("href", openable);
  anchor.textContent = written;
  ctx.lineStart = false;
}

function renderLink(ctx: RenderContext, parent: Node, node: SyntaxNode): void {
  const parts = linkParts(ctx.text, node);
  const url = linkUrl(ctx.text, ctx.refs, parts);
  const openable = url === null ? null : toOpenableUrl(url);
  if (url === null || openable === null) {
    renderInlineRange(ctx, parent, node, parts.contentFrom, parts.contentTo);
    return;
  }
  const anchor = appendElement(ctx, parent, "a");
  anchor.setAttribute("href", openable);
  renderInlineRange(ctx, anchor, node, parts.contentFrom, parts.contentTo);
  const visible = (anchor.textContent ?? "").trim();
  if (visible !== url && visible !== openable)
    appendUrlSuffix(ctx, parent, url);
  ctx.lineStart = false;
}

function renderImage(ctx: RenderContext, parent: Node, node: SyntaxNode): void {
  const parts = linkParts(ctx.text, node);
  const url = linkUrl(ctx.text, ctx.refs, parts) ?? "";
  const alt = plainText(ctx.text, node, parts.contentFrom, parts.contentTo)
    .replace(/\s+/g, " ")
    .trim();
  const image = appendElement(ctx, parent, "span");
  image.className = "print-image";
  image.textContent = alt || url || ctx.text.slice(node.from, node.to);
  if (alt && url) appendUrlSuffix(ctx, parent, url);
  ctx.lineStart = false;
}

function renderInline(
  ctx: RenderContext,
  parent: Node,
  node: SyntaxNode,
): void {
  switch (node.name) {
    case "Emphasis":
    case "StrongEmphasis":
    case "Strikethrough": {
      const tag =
        node.name === "Emphasis"
          ? "em"
          : node.name === "StrongEmphasis"
            ? "strong"
            : "s";
      const element = appendElement(ctx, parent, tag);
      renderInlineRange(ctx, element, node, node.from, node.to);
      return;
    }
    case "InlineCode":
      appendElement(ctx, parent, "code").textContent = inlineCodeText(
        ctx.text,
        node,
      );
      ctx.lineStart = false;
      return;
    case "Link":
      renderLink(ctx, parent, node);
      return;
    case "Image":
      renderImage(ctx, parent, node);
      return;
    case "Autolink":
      renderUrl(ctx, parent, node.getChild("URL") ?? node);
      return;
    case "URL":
      renderUrl(ctx, parent, node);
      return;
    case "Escape":
      emitText(ctx, parent, ctx.text.slice(node.from + 1, node.to));
      return;
    case "HardBreak":
      appendElement(ctx, parent, "br");
      ctx.lineStart = true;
      return;
    default:
      emitText(ctx, parent, ctx.text.slice(node.from, node.to));
  }
}

function removeTrailingBreaks(element: Element): void {
  while (element.lastChild?.nodeName === "BR") {
    element.removeChild(element.lastChild);
  }
}

function renderInlineBlock(
  ctx: RenderContext,
  element: Element,
  node: SyntaxNode,
  range: [number, number],
): void {
  ctx.lineStart = true;
  renderInlineRange(ctx, element, node, range[0], range[1]);
  removeTrailingBreaks(element);
}

function renderSourceParagraph(
  ctx: RenderContext,
  parent: Node,
  node: SyntaxNode,
): void {
  const paragraph = appendElement(ctx, parent, "p");
  const [from, to] = trimRange(ctx.text, node.from, node.to);
  ctx.lineStart = true;
  emitText(ctx, paragraph, ctx.text.slice(from, to));
}

function lineStartOf(text: string, pos: number): number {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

function hasAncestor(node: SyntaxNode, name: string): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === name) return true;
  }
  return false;
}

function stripLinePrefix(
  line: string,
  width: number,
  inQuote: boolean,
): string {
  let index = 0;
  while (
    index < width &&
    index < line.length &&
    (line[index] === " " ||
      line[index] === "\t" ||
      (inQuote && line[index] === ">"))
  ) {
    index++;
  }
  return line.slice(index);
}

function codeBlockText(text: string, node: SyntaxNode): string {
  const width = node.from - lineStartOf(text, node.from);
  const inQuote = hasAncestor(node, "Blockquote");
  let from = node.from;
  let to = node.to;
  let stripFirst = false;
  if (node.name === "FencedCode") {
    const codeText = node.getChildren("CodeText");
    if (codeText.length === 0) return "";
    const opening = node.firstChild;
    const closing = node.lastChild;
    const openingEnd = text.indexOf("\n", opening?.to ?? node.from);
    if (openingEnd === -1) return "";
    from = openingEnd + 1;
    if (
      closing &&
      closing.from > (opening?.from ?? -1) &&
      closing.name === "CodeMark"
    ) {
      to = Math.max(from, lineStartOf(text, closing.from) - 1);
    }
    stripFirst = true;
  }
  return text
    .slice(from, to)
    .split("\n")
    .map((line, index) =>
      index > 0 || stripFirst ? stripLinePrefix(line, width, inQuote) : line,
    )
    .join("\n");
}

function renderCode(ctx: RenderContext, parent: Node, node: SyntaxNode): void {
  const pre = appendElement(ctx, parent, "pre");
  appendElement(ctx, pre, "code").textContent = codeBlockText(ctx.text, node);
}

function renderList(ctx: RenderContext, parent: Node, node: SyntaxNode): void {
  if (node.name === "OrderedList") {
    const list = appendElement(ctx, parent, "ol");
    const mark = node.firstChild?.getChild("ListMark");
    const start = mark ? parseInt(ctx.text.slice(mark.from, mark.to), 10) : 1;
    if (!Number.isNaN(start) && start !== 1) list.start = start;
    renderBlocks(ctx, list, node);
  } else {
    renderBlocks(ctx, appendElement(ctx, parent, "ul"), node);
  }
}

function renderTask(ctx: RenderContext, item: Element, task: SyntaxNode): void {
  const marker = task.getChild("TaskMarker");
  const done = marker
    ? /x/i.test(ctx.text.slice(marker.from, marker.to))
    : false;
  item.setAttribute("data-task", done ? "done" : "open");
  const box = ctx.doc.createElement("span");
  box.className = "print-task-box";
  box.setAttribute("aria-hidden", "true");
  item.insertBefore(box, item.firstChild);
  let from = marker?.to ?? task.from;
  if (ctx.text[from] === " ") from++;
  const [, to] = trimRange(ctx.text, from, task.to);
  renderInlineBlock(ctx, item, task, [from, to]);
}

function renderListItem(
  ctx: RenderContext,
  parent: Node,
  node: SyntaxNode,
): void {
  const item = appendElement(ctx, parent, "li");
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "Task") renderTask(ctx, item, child);
    else renderBlock(ctx, item, child);
  }
}

function alignments(separator: string): string[] {
  return separator
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => {
      const spec = cell.trim();
      const left = spec.startsWith(":");
      const right = spec.endsWith(":");
      if (left && right) return "center";
      if (left) return "left";
      if (right) return "right";
      return "";
    });
}

function rowCells(row: SyntaxNode): Array<SyntaxNode | null> {
  const delimiters = row.getChildren("TableDelimiter");
  const cells = row.getChildren("TableCell");
  const segments: Array<[number, number]> = [];
  let start = row.from;
  for (const delimiter of delimiters) {
    segments.push([start, delimiter.from]);
    start = delimiter.to;
  }
  segments.push([start, row.to]);
  if (delimiters[0]?.from === row.from) segments.shift();
  if (delimiters[delimiters.length - 1]?.to === row.to) segments.pop();
  return segments.map(
    ([from, to]) =>
      cells.find((cell) => cell.from >= from && cell.to <= to) ?? null,
  );
}

function renderTableRow(
  ctx: RenderContext,
  parent: Node,
  row: SyntaxNode,
  tag: "th" | "td",
  columns: number,
  aligns: readonly string[],
): void {
  const tr = appendElement(ctx, parent, "tr");
  const cells = rowCells(row);
  for (let column = 0; column < columns; column++) {
    const element = appendElement(ctx, tr, tag);
    if (aligns[column]) element.style.textAlign = aligns[column];
    const cell = cells[column];
    if (cell) {
      renderInlineBlock(
        ctx,
        element,
        cell,
        trimRange(ctx.text, cell.from, cell.to),
      );
    }
  }
}

function renderTable(ctx: RenderContext, parent: Node, node: SyntaxNode): void {
  const header = node.getChild("TableHeader");
  if (!header) {
    renderSourceParagraph(ctx, parent, node);
    return;
  }
  const separator = node.getChild("TableDelimiter");
  const aligns = separator
    ? alignments(ctx.text.slice(separator.from, separator.to))
    : [];
  const columns = rowCells(header).length;
  const table = appendElement(ctx, parent, "table");
  renderTableRow(
    ctx,
    appendElement(ctx, table, "thead"),
    header,
    "th",
    columns,
    aligns,
  );
  const rows = node.getChildren("TableRow");
  if (rows.length === 0) return;
  const body = appendElement(ctx, table, "tbody");
  for (const row of rows) renderTableRow(ctx, body, row, "td", columns, aligns);
}

function renderBlocks(
  ctx: RenderContext,
  parent: Node,
  node: SyntaxNode,
): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    renderBlock(ctx, parent, child);
  }
}

function renderBlock(ctx: RenderContext, parent: Node, node: SyntaxNode): void {
  const atx = ATX_HEADING.exec(node.name);
  const setext = SETEXT_HEADING.exec(node.name);
  if (atx || setext) {
    const level = (atx ?? setext)![1];
    const heading = appendElement(ctx, parent, `h${level}` as "h1");
    renderInlineBlock(ctx, heading, node, headingRange(ctx.text, node));
    return;
  }
  switch (node.name) {
    case "QuoteMark":
    case "ListMark":
    case "LinkReference":
      return;
    case "Paragraph":
      renderInlineBlock(
        ctx,
        appendElement(ctx, parent, "p"),
        node,
        trimRange(ctx.text, node.from, node.to),
      );
      return;
    case "Blockquote":
      renderBlocks(ctx, appendElement(ctx, parent, "blockquote"), node);
      return;
    case "BulletList":
    case "OrderedList":
      renderList(ctx, parent, node);
      return;
    case "ListItem":
      renderListItem(ctx, parent, node);
      return;
    case "FencedCode":
    case "CodeBlock":
      renderCode(ctx, parent, node);
      return;
    case "HorizontalRule":
      appendElement(ctx, parent, "hr");
      return;
    case "Table":
      renderTable(ctx, parent, node);
      return;
    default:
      renderSourceParagraph(ctx, parent, node);
  }
}

export function renderPrintMarkdown(
  text: string,
  doc: Document = document,
): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  if (!text.trim()) return fragment;
  const tree = parse(text);
  const ctx: RenderContext = {
    text,
    doc,
    refs: collectReferences(text, tree),
    lineStart: true,
  };
  renderBlocks(ctx, fragment, tree.topNode);
  return fragment;
}
