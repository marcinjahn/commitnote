import {
  type EditorState,
  type Extension,
  Facet,
  type Range,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { ImageId } from "../images/image-id";
import { imageAltText, parseImageUrl } from "../images/image-reference";
import type { ImageSource } from "../images/image-source";
import { lineHasSelection } from "./live-preview";

export interface ImageOpenRequest {
  readonly imageId: ImageId;
  readonly alt: string;
  readonly width?: number;
  readonly height?: number;
  readonly thumbnail: HTMLElement;
  readonly remove: (() => void) | null;
}

export type ImageOpenHandler = (request: ImageOpenRequest) => void;

export const imageSource: Facet<ImageSource, ImageSource | null> = Facet.define<
  ImageSource,
  ImageSource | null
>({
  combine: (values) => values[0] ?? null,
});

export const imageOpenHandler: Facet<
  ImageOpenHandler,
  ImageOpenHandler | null
> = Facet.define<ImageOpenHandler, ImageOpenHandler | null>({
  combine: (values) => values[0] ?? null,
});

const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";
const DESKTOP_MAX_HEIGHT = 360;
const MOBILE_MAX_HEIGHT = 260;
const WIDGET_PADDING = 16;
const UNSIZED_ESTIMATED_HEIGHT = 176;
const UNAVAILABLE_TEXT = "Image unavailable";

type ImageState = "loading" | "loaded" | "unavailable";

interface FoundReference {
  readonly from: number;
  readonly to: number;
  readonly imageId: ImageId;
  readonly alt: string;
  readonly width?: number;
  readonly height?: number;
}

export function devicePixelRatio(): number {
  return globalThis.devicePixelRatio || 1;
}

function isDesktop(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return true;
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

const discarded = new WeakSet<HTMLElement>();

export class ImageWidget extends WidgetType {
  constructor(
    readonly imageId: ImageId,
    readonly alt: string,
    readonly width?: number,
    readonly height?: number,
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return (
      other.imageId === this.imageId &&
      other.alt === this.alt &&
      other.width === this.width &&
      other.height === this.height
    );
  }

  override get estimatedHeight(): number {
    if (this.width === undefined || this.height === undefined) {
      return UNSIZED_ESTIMATED_HEIGHT;
    }
    const maxHeight = isDesktop() ? DESKTOP_MAX_HEIGHT : MOBILE_MAX_HEIGHT;
    return (
      Math.min(maxHeight, Math.round(this.height / devicePixelRatio())) +
      WIDGET_PADDING
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-image-widget";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-image";
    button.dataset.imageId = this.imageId;
    button.setAttribute("aria-label", this.alt || "Image");

    const dpr = devicePixelRatio();
    if (this.width !== undefined && this.height !== undefined) {
      button.style.setProperty("--image-width", `${this.width / dpr}px`);
      button.style.setProperty(
        "--image-ratio",
        `${this.width} / ${this.height}`,
      );
    } else {
      button.classList.add("cm-image-unsized");
    }

    const img = document.createElement("img");
    img.alt = this.alt;
    img.draggable = false;

    const status = document.createElement("span");
    status.className = "cm-image-status";
    status.textContent = UNAVAILABLE_TEXT;

    button.append(img, status);
    wrapper.appendChild(button);

    let generation = 0;

    const setState = (state: ImageState): void => {
      button.dataset.state = state;
    };

    const resolve = (): void => {
      const source = view.state.facet(imageSource);
      const current = ++generation;
      img.removeAttribute("src");
      if (!source) {
        setState("unavailable");
        return;
      }
      setState("loading");
      source(this.imageId).then(
        (result) => {
          if (discarded.has(wrapper) || current !== generation) return;
          if ("url" in result) {
            img.src = result.url;
          } else {
            setState("unavailable");
            view.requestMeasure();
          }
        },
        () => {
          if (discarded.has(wrapper) || current !== generation) return;
          setState("unavailable");
          view.requestMeasure();
        },
      );
    };

    img.addEventListener("load", () => {
      if (discarded.has(wrapper) || !img.getAttribute("src")) return;
      if (button.classList.contains("cm-image-unsized")) {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          button.style.setProperty(
            "--image-width",
            `${img.naturalWidth / devicePixelRatio()}px`,
          );
          button.style.setProperty(
            "--image-ratio",
            `${img.naturalWidth} / ${img.naturalHeight}`,
          );
        }
        button.classList.remove("cm-image-unsized");
      }
      setState("loaded");
      view.requestMeasure();
    });
    img.addEventListener("error", () => {
      if (discarded.has(wrapper) || !img.getAttribute("src")) return;
      setState("unavailable");
      view.requestMeasure();
    });

    button.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      const state = button.dataset.state;
      if (state === "loaded") {
        const handler = view.state.facet(imageOpenHandler);
        if (!handler) return;
        const imageId = this.imageId;
        const request: ImageOpenRequest = {
          imageId,
          alt: this.alt,
          ...(this.width !== undefined && this.height !== undefined
            ? { width: this.width, height: this.height }
            : {}),
          thumbnail: button,
          remove: view.state.readOnly
            ? null
            : () => {
                let near: number;
                try {
                  near = view.posAtDOM(wrapper);
                } catch {
                  return;
                }
                removeImageReference(view, imageId, near);
              },
        };
        handler(request);
      } else if (state === "unavailable" && view.state.facet(imageSource)) {
        resolve();
      }
    });

    resolve();
    return wrapper;
  }

  override destroy(dom: HTMLElement): void {
    discarded.add(dom);
  }
}

function docMentionsImages(state: EditorState): boolean {
  for (const iter = state.doc.iter(); !iter.next().done;) {
    if (iter.value.includes("image:")) return true;
  }
  return false;
}

function readReference(
  state: EditorState,
  node: SyntaxNode,
): FoundReference | null {
  const url = node.getChild("URL");
  if (!url) return null;
  const target = parseImageUrl(state.doc.sliceString(url.from, url.to));
  if (!target) return null;
  const marks = node.getChildren("LinkMark");
  const opening = marks[0];
  const closingBracket = marks.filter((mark) => mark.to <= url.from).at(-2);
  if (!opening || !closingBracket) return null;
  return {
    from: node.from,
    to: node.to,
    imageId: target.imageId,
    alt: imageAltText(state.doc.sliceString(opening.to, closingBracket.from)),
    ...(target.width !== undefined && target.height !== undefined
      ? { width: target.width, height: target.height }
      : {}),
  };
}

function findReferences(state: EditorState): FoundReference[] {
  if (!docMentionsImages(state)) return [];
  const tree =
    ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  const references: FoundReference[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "Table") return false;
      if (node.name !== "Image") return;
      const reference = readReference(state, node.node);
      if (reference) references.push(reference);
      return false;
    },
  });
  return references;
}

function buildImageWidgetDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  for (const reference of findReferences(state)) {
    if (!lineHasSelection(state, reference.from, reference.to)) {
      decorations.push(
        Decoration.replace({}).range(reference.from, reference.to),
      );
    }
    decorations.push(
      Decoration.widget({
        widget: new ImageWidget(
          reference.imageId,
          reference.alt,
          reference.width,
          reference.height,
        ),
        block: true,
        side: 1,
      }).range(state.doc.lineAt(reference.to).to),
    );
  }
  return Decoration.set(decorations, true);
}

export const imageWidgetsField = StateField.define<DecorationSet>({
  create: buildImageWidgetDecorations,
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.state.readOnly !== tr.startState.readOnly ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      return buildImageWidgetDecorations(tr.state);
    }
    if (tr.selection && !tr.state.selection.eq(tr.startState.selection)) {
      return value.size === 0 ? value : buildImageWidgetDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function distance(reference: FoundReference, pos: number): number {
  if (pos < reference.from) return reference.from - pos;
  if (pos > reference.to) return pos - reference.to;
  return 0;
}

export function removeImageReference(
  view: EditorView,
  imageId: ImageId,
  near: number,
): boolean {
  const state = view.state;
  if (state.readOnly) return false;
  let closest: FoundReference | null = null;
  for (const reference of findReferences(state)) {
    if (reference.imageId !== imageId) continue;
    if (!closest || distance(reference, near) < distance(closest, near)) {
      closest = reference;
    }
  }
  if (!closest) return false;

  const doc = state.doc;
  const firstLine = doc.lineAt(closest.from);
  const lastLine = doc.lineAt(closest.to);
  const before = doc.sliceString(firstLine.from, closest.from);
  const after = doc.sliceString(closest.to, lastLine.to);
  let from = closest.from;
  let to = closest.to;
  if (before.trim() === "" && after.trim() === "") {
    if (lastLine.number < doc.lines) {
      from = firstLine.from;
      to = lastLine.to + 1;
    } else if (firstLine.number > 1) {
      from = firstLine.from - 1;
      to = lastLine.to;
    } else {
      from = firstLine.from;
      to = lastLine.to;
    }
  }
  view.dispatch({ changes: { from, to }, userEvent: "delete" });
  return true;
}

const imageWidgetsTheme = EditorView.baseTheme({
  ".cm-image-widget": {
    padding: "var(--space-2) 0",
  },
  ".cm-image": {
    display: "block",
    position: "relative",
    padding: "0",
    margin: "0",
    border: "var(--hairline) solid var(--color-border)",
    borderRadius: "0",
    background: "var(--color-surface)",
    cursor: "zoom-in",
    "--image-max-height": "360px",
    width:
      "min(100%, var(--image-width), calc(var(--image-max-height) * var(--image-ratio)))",
    aspectRatio: "var(--image-ratio)",
    overflow: "hidden",
  },
  "@media (max-width: 767.98px)": {
    ".cm-image": {
      "--image-max-height": "260px",
    },
  },
  ".cm-image img": {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    visibility: "hidden",
  },
  '.cm-image[data-state="loaded"] img': {
    visibility: "visible",
  },
  ".cm-image-unsized": {
    width: "100%",
    height: "160px",
  },
  ".cm-image:focus-visible": {
    outline: "2px solid var(--color-accent)",
    outlineOffset: "2px",
  },
  ".cm-image-status": {
    display: "none",
    position: "absolute",
    inset: "0",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--space-2)",
    color: "var(--color-text-muted)",
    fontSize: "var(--font-size-sm)",
    textAlign: "center",
  },
  '.cm-image[data-state="unavailable"] .cm-image-status': {
    display: "flex",
  },
});

export function imageWidgets(): Extension {
  return [imageWidgetsField, imageWidgetsTheme];
}
