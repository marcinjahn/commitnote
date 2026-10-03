import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

const OPENABLE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function isOpenableUrl(url: string): boolean {
  if (url === "") return false;
  try {
    return OPENABLE_PROTOCOLS.has(new URL(url).protocol.toLowerCase());
  } catch {
    return false;
  }
}

function isLinkDestination(state: EditorState, node: SyntaxNode): boolean {
  const prev = node.prevSibling;
  return (
    prev?.name === "LinkMark" && state.sliceDoc(prev.from, prev.to) === "("
  );
}

function destinationOf(state: EditorState, link: SyntaxNode): SyntaxNode | null {
  for (let child = link.firstChild; child; child = child.nextSibling) {
    if (child.name === "URL" && isLinkDestination(state, child)) return child;
  }
  return null;
}

function urlNodeFrom(state: EditorState, start: SyntaxNode): SyntaxNode | null {
  for (let node: SyntaxNode | null = start; node; node = node.parent) {
    switch (node.name) {
      case "Link":
        return destinationOf(state, node);
      case "Autolink":
        return node.getChild("URL");
      case "URL": {
        const parent = node.parent;
        if (parent?.name === "Link") return destinationOf(state, parent);
        return node;
      }
    }
  }
  return null;
}

export function linkUrlAt(state: EditorState, pos: number): string | null {
  const tree =
    ensureSyntaxTree(state, state.doc.length) ?? syntaxTree(state);
  for (const side of [1, -1] as const) {
    const urlNode = urlNodeFrom(state, tree.resolveInner(pos, side));
    if (!urlNode) continue;
    const url = state.sliceDoc(urlNode.from, urlNode.to).trim();
    if (isOpenableUrl(url)) return url;
  }
  return null;
}
