import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { toOpenableUrl } from "./link-open";

const BLOCKED_NODES = new Set([
  "InlineCode",
  "FencedCode",
  "CodeBlock",
  "Link",
  "Image",
  "Autolink",
  "URL",
]);
const WWW_PREFIX = /^www\./i;
const MAILTO_PREFIX = /^mailto:/i;

function overlapsBlockedNode(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const tree = ensureSyntaxTree(state, state.doc.length) ?? syntaxTree(state);
  let blocked = false;
  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (blocked) return false;
      if (BLOCKED_NODES.has(node.name) && node.from < to && node.to > from) {
        blocked = true;
        return false;
      }
    },
  });
  return blocked;
}

function destinationFor(token: string): string | null {
  const openable = toOpenableUrl(token);
  if (openable === null) return null;
  let destination = token;
  if (WWW_PREFIX.test(token)) destination = `https://${token}`;
  else if (openable.startsWith("mailto:") && !MAILTO_PREFIX.test(token)) {
    destination = `mailto:${token}`;
  }
  if (/[<>]/.test(destination)) return null;
  return /[()]/.test(destination) ? `<${destination}>` : destination;
}

export function pasteLinkChange(
  state: EditorState,
  pasted: string,
): TransactionSpec | null {
  if (!state.facet(EditorView.editable) || state.readOnly) return null;
  if (state.selection.ranges.length !== 1) return null;
  const { from, to } = state.selection.main;
  if (from === to) return null;
  if (state.doc.lineAt(from).number !== state.doc.lineAt(to).number) {
    return null;
  }
  const token = pasted.trim();
  if (token === "" || /\s/.test(token)) return null;
  const destination = destinationFor(token);
  if (destination === null) return null;
  if (overlapsBlockedNode(state, from, to)) return null;

  const label = state.sliceDoc(from, to).replace(/[[\]]/g, "\\$&");
  const insert = `[${label}](${destination})`;
  return {
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: "input.paste",
    scrollIntoView: true,
  };
}

export function pasteLink(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return false;
      const spec = pasteLinkChange(view.state, text);
      if (spec === null) return false;
      event.preventDefault();
      view.dispatch(spec);
      return true;
    },
  });
}
