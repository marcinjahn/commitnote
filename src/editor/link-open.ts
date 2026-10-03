import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  RangeSetBuilder,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
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

export interface LinkOpenOptions {
  readonly open?: (url: string) => void;
}

const ARMED_CLASS = "cm-link-open-armed";
const linkMark = Decoration.mark({ class: "cm-link" });

function buildLinkMarks(view: EditorView): DecorationSet {
  const { state } = view;
  const tree =
    ensureSyntaxTree(state, state.doc.length) ?? syntaxTree(state);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const isLink = node.name === "Link" || node.name === "Autolink";
        const isBareUrl =
          node.name === "URL" &&
          node.node.parent?.name !== "Link" &&
          node.node.parent?.name !== "Autolink";
        if (!isLink && !isBareUrl) return;
        if (node.from < lastTo) return false;
        if (linkUrlAt(state, node.from) === null) return false;
        builder.add(node.from, node.to, linkMark);
        lastTo = node.to;
        return false;
      },
    });
  }
  return builder.finish();
}

const linkMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLinkMarks(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildLinkMarks(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function hasModifier(event: MouseEvent | KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

function linkUnderPointer(view: EditorView, event: MouseEvent): string | null {
  if (event.button !== 0 || !hasModifier(event)) return null;
  const target = event.target;
  if (!(target instanceof Node) || !view.contentDOM.contains(target)) {
    return null;
  }
  const element = target instanceof Element ? target : target.parentElement;
  const linkElement = element?.closest(".cm-link");
  if (!linkElement || !view.contentDOM.contains(linkElement)) return null;
  return linkUrlAt(view.state, view.posAtDOM(linkElement));
}

function setArmed(view: EditorView, armed: boolean): boolean {
  view.dom.classList.toggle(ARMED_CLASS, armed);
  return false;
}

export function linkOpen(options: LinkOpenOptions = {}): Extension {
  const open =
    options.open ??
    ((url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    });

  return [
    linkMarks,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const url = linkUnderPointer(view, event);
        if (url === null) return false;
        event.preventDefault();
        open(url);
        return true;
      },
      click(event, view) {
        if (linkUnderPointer(view, event) === null) return false;
        event.preventDefault();
        return true;
      },
      keydown: (event, view) => setArmed(view, hasModifier(event)),
      keyup: (event, view) => setArmed(view, hasModifier(event)),
      mousemove: (event, view) => setArmed(view, hasModifier(event)),
      mouseleave: (_event, view) => setArmed(view, false),
      blur: (_event, view) => setArmed(view, false),
    }),
    EditorView.baseTheme({
      [`&.${ARMED_CLASS} .cm-link`]: { cursor: "pointer" },
    }),
  ];
}
