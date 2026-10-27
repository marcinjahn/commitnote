import type { SyntaxNode } from "@lezer/common";
import { toOpenableUrl } from "../markdown/openable-url";

type Read = (from: number, to: number) => string;

interface Context {
  doc: Document;
  read: Read;
}

const INLINE_ELEMENTS: Record<string, { tag: string; mark: string }> = {
  Emphasis: { tag: "em", mark: "EmphasisMark" },
  StrongEmphasis: { tag: "strong", mark: "EmphasisMark" },
  Strikethrough: { tag: "s", mark: "StrikethroughMark" },
  Superscript: { tag: "sup", mark: "SuperscriptMark" },
  Subscript: { tag: "sub", mark: "SubscriptMark" },
};

export function renderTableCellContent(
  parent: HTMLElement,
  cell: SyntaxNode,
  read: Read,
): void {
  const ctx: Context = { doc: parent.ownerDocument, read };
  renderRange(ctx, parent, cell, cell.from, cell.to, false);
}

function renderRange(
  ctx: Context,
  parent: Node,
  node: SyntaxNode,
  from: number,
  to: number,
  inLink: boolean,
): void {
  let pos = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    appendText(ctx, parent, pos, child.from);
    renderNode(ctx, parent, child, inLink);
    pos = child.to;
  }
  appendText(ctx, parent, pos, to);
}

function appendText(ctx: Context, parent: Node, from: number, to: number): void {
  if (to > from) parent.appendChild(ctx.doc.createTextNode(ctx.read(from, to)));
}

function appendString(ctx: Context, parent: Node, text: string): void {
  if (text) parent.appendChild(ctx.doc.createTextNode(text));
}

function innerRange(node: SyntaxNode, markName: string): [number, number] {
  const marks = node.getChildren(markName);
  const from = marks[0]?.to ?? node.from;
  const to = marks.length > 1 ? marks[marks.length - 1].from : node.to;
  return [from, to];
}

function labelRange(node: SyntaxNode): [number, number] {
  const marks = node.getChildren("LinkMark");
  return [marks[0]?.to ?? node.from, marks.length > 1 ? marks[1].from : node.to];
}

function destinationOf(ctx: Context, link: SyntaxNode): SyntaxNode | null {
  for (let child = link.firstChild; child; child = child.nextSibling) {
    if (child.name !== "URL") continue;
    const prev = child.prevSibling;
    if (prev?.name === "LinkMark" && ctx.read(prev.from, prev.to) === "(") {
      return child;
    }
  }
  return null;
}

function createLinkSpan(ctx: Context, url: string): HTMLElement {
  const span = ctx.doc.createElement("span");
  span.className = "cm-table-link";
  span.dataset.url = url;
  return span;
}

function renderUrlText(
  ctx: Context,
  parent: Node,
  text: string,
  inLink: boolean,
): void {
  const url = inLink ? null : toOpenableUrl(text);
  if (url === null) {
    appendString(ctx, parent, text);
    return;
  }
  const span = createLinkSpan(ctx, url);
  appendString(ctx, span, text);
  parent.appendChild(span);
}

function renderNode(
  ctx: Context,
  parent: Node,
  node: SyntaxNode,
  inLink: boolean,
): void {
  const inline = INLINE_ELEMENTS[node.name];
  if (inline) {
    const element = ctx.doc.createElement(inline.tag);
    const [from, to] = innerRange(node, inline.mark);
    renderRange(ctx, element, node, from, to, inLink);
    parent.appendChild(element);
    return;
  }
  switch (node.name) {
    case "InlineCode": {
      const code = ctx.doc.createElement("code");
      const [from, to] = innerRange(node, "CodeMark");
      appendText(ctx, code, from, to);
      parent.appendChild(code);
      return;
    }
    case "Escape":
      appendText(ctx, parent, node.from + 1, node.to);
      return;
    case "Link":
      renderLink(ctx, parent, node, inLink);
      return;
    case "Image": {
      const [from, to] = labelRange(node);
      appendText(ctx, parent, from, to);
      return;
    }
    case "Autolink": {
      const url = node.getChild("URL");
      if (url) {
        renderUrlText(ctx, parent, ctx.read(url.from, url.to), inLink);
      } else {
        appendText(ctx, parent, node.from, node.to);
      }
      return;
    }
    case "URL":
      renderUrlText(ctx, parent, ctx.read(node.from, node.to), inLink);
      return;
    default:
      appendText(ctx, parent, node.from, node.to);
  }
}

function renderLink(
  ctx: Context,
  parent: Node,
  link: SyntaxNode,
  inLink: boolean,
): void {
  const [labelFrom, labelTo] = labelRange(link);
  const destination = destinationOf(ctx, link);
  const url =
    destination && !inLink
      ? toOpenableUrl(ctx.read(destination.from, destination.to))
      : null;
  if (url === null) {
    renderRange(ctx, parent, link, labelFrom, labelTo, inLink);
    return;
  }
  const span = createLinkSpan(ctx, url);
  renderRange(ctx, span, link, labelFrom, labelTo, true);
  parent.appendChild(span);
}
