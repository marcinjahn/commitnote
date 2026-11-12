import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export const VERBATIM_NODE_NAMES: ReadonlySet<string> = new Set([
  "InlineCode",
  "FencedCode",
  "CodeBlock",
  "URL",
  "Autolink",
]);

const CLOSING_MARKS: ReadonlyMap<string, string> = new Map([
  ["InlineCode", "CodeMark"],
  ["FencedCode", "CodeMark"],
  ["Autolink", "LinkMark"],
]);

function closedAt(node: SyntaxNode, pos: number): boolean {
  const closingMark = CLOSING_MARKS.get(node.name);
  const last = node.lastChild;
  const first = node.firstChild;
  return (
    node.to === pos &&
    last !== null &&
    first !== null &&
    last.name === closingMark &&
    last.to === pos &&
    last.from !== first.from
  );
}

export function isVerbatimPosition(state: EditorState, pos: number): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  ) {
    if (VERBATIM_NODE_NAMES.has(node.name)) return !closedAt(node, pos);
  }
  return false;
}
