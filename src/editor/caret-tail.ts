import { findClusterBreak, type EditorState } from "@codemirror/state";
import type { EditorView, LayerMarker } from "@codemirror/view";
import { CARET_TAIL_LENGTH, caretTailStops } from "./caret-style";

export interface TailCluster {
  from: number;
  to: number;
  ink: boolean;
  emoji: boolean;
}

const OVERHANG_EM = 0.2;
const BLEED_EM = 0.12;
const EMOJI_PRESENTATION =
  /\p{Emoji_Presentation}|\uFE0F|\p{Regional_Indicator}|\u20E3/u;

export function tailClusters(
  state: EditorState,
  caret: number,
  length = CARET_TAIL_LENGTH,
): TailCluster[] {
  const line = state.doc.lineAt(caret);
  const clusters: TailCluster[] = [];
  let end = caret - line.from;
  while (end > 0 && clusters.length < length) {
    const start = findClusterBreak(line.text, end, false);
    const cluster = line.text.slice(start, end);
    clusters.unshift({
      from: line.from + start,
      to: line.from + end,
      ink: !/\s/u.test(cluster),
      emoji: EMOJI_PRESENTATION.test(cluster),
    });
    end = start;
  }
  return clusters;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface EmojiGlyph {
  text: string;
  font: string;
  top: number;
  height: number;
}

export interface TailPiece extends Box {
  from: number;
  to: number;
  emoji?: EmojiGlyph;
}

const FONT_PROPERTIES = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-stretch",
] as const;

function emojiGlyph(
  view: EditorView,
  cluster: TailCluster,
  box: Box,
): EmojiGlyph | undefined {
  const { node } = view.domAtPos(cluster.from, 1);
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return undefined;
  const style = getComputedStyle(element);
  return {
    text: view.state.doc.sliceString(cluster.from, cluster.to),
    font: FONT_PROPERTIES.map(
      (property) => `${property}: ${style.getPropertyValue(property)}`,
    ).join("; "),
    top: box.top,
    height: box.bottom - box.top,
  };
}

function clusterBox(view: EditorView, cluster: TailCluster): Box | undefined {
  const start = view.coordsAtPos(cluster.from, 1);
  const end = view.coordsAtPos(cluster.to, -1);
  if (!start || !end || end.left <= start.left) return undefined;
  return {
    left: start.left,
    right: end.left,
    top: end.top,
    bottom: end.bottom,
  };
}

function endsWord(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return pos === line.to || /\s/u.test(state.doc.sliceString(pos, pos + 1));
}

export function measureTail(
  view: EditorView,
  clusters: TailCluster[],
): TailPiece[] {
  const stops = caretTailStops(clusters.length);
  const pieces: TailPiece[] = [];
  let lastInked: TailCluster | undefined;
  clusters.forEach((cluster, index) => {
    if (!cluster.ink) return;
    const box = clusterBox(view, cluster);
    if (!box) return;
    const height = box.bottom - box.top;
    const bleed = height * BLEED_EM;
    pieces.push({
      ...box,
      top: box.top - bleed,
      bottom: box.bottom + bleed,
      from: stops[index],
      to: stops[index + 1],
      emoji: cluster.emoji ? emojiGlyph(view, cluster, box) : undefined,
    });
    lastInked = cluster;
  });
  const last = pieces[pieces.length - 1];
  if (
    last &&
    lastInked &&
    !lastInked.emoji &&
    endsWord(view.state, lastInked.to)
  ) {
    const overhang = (last.bottom - last.top) * OVERHANG_EM;
    pieces.push({
      ...last,
      emoji: undefined,
      left: last.right,
      right: last.right + overhang,
      from: last.to,
      to: last.to,
    });
  }
  return pieces;
}

const accentAt = (fraction: number) =>
  `color-mix(in srgb, var(--color-accent) ${Math.round(fraction * 1000) / 10}%, transparent)`;

export class BoxMarker implements LayerMarker {
  constructor(
    readonly className: string,
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number,
    readonly background: string,
  ) {}

  eq(other: LayerMarker): boolean {
    return (
      other instanceof BoxMarker &&
      other.className === this.className &&
      other.left === this.left &&
      other.top === this.top &&
      other.width === this.width &&
      other.height === this.height &&
      other.background === this.background
    );
  }

  draw(): HTMLElement {
    const dom = document.createElement("div");
    dom.className = this.className;
    this.paint(dom);
    return dom;
  }

  update(dom: HTMLElement, prev: LayerMarker): boolean {
    if (!(prev instanceof BoxMarker) || prev.className !== this.className)
      return false;
    this.paint(dom);
    return true;
  }

  private paint(dom: HTMLElement): void {
    dom.style.left = `${this.left}px`;
    dom.style.top = `${this.top}px`;
    dom.style.width = `${this.width}px`;
    dom.style.height = `${this.height}px`;
    dom.style.background = this.background;
  }
}

class EmojiTintMarker implements LayerMarker {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly glyph: EmojiGlyph,
    readonly background: string,
  ) {}

  eq(other: LayerMarker): boolean {
    return (
      other instanceof EmojiTintMarker &&
      other.left === this.left &&
      other.top === this.top &&
      other.background === this.background &&
      other.glyph.text === this.glyph.text &&
      other.glyph.font === this.glyph.font &&
      other.glyph.height === this.glyph.height
    );
  }

  draw(): HTMLElement {
    const dom = document.createElement("div");
    dom.className = "cm-caret-tint cm-caret-tint-emoji";
    dom.append(document.createElement("span"));
    this.paint(dom);
    return dom;
  }

  update(dom: HTMLElement, prev: LayerMarker): boolean {
    if (!(prev instanceof EmojiTintMarker)) return false;
    this.paint(dom);
    return true;
  }

  private paint(dom: HTMLElement): void {
    dom.style.cssText = `${this.glyph.font}; left: ${this.left}px; top: ${this.top}px; height: ${this.glyph.height}px; line-height: ${this.glyph.height}px;`;
    const copy = dom.firstElementChild as HTMLElement;
    copy.textContent = this.glyph.text;
    copy.style.backgroundImage = this.background;
  }
}

export function tintMarker(
  piece: TailPiece,
  origin: { left: number; top: number },
  blend: "lighten" | "darken",
): LayerMarker {
  const gradient = `linear-gradient(to right, ${accentAt(piece.from)}, ${accentAt(piece.to)})`;
  if (piece.emoji) {
    return new EmojiTintMarker(
      piece.left - origin.left,
      piece.emoji.top - origin.top,
      piece.emoji,
      gradient,
    );
  }
  return new BoxMarker(
    `cm-caret-tint cm-caret-tint-${blend}`,
    piece.left - origin.left,
    piece.top - origin.top,
    piece.right - piece.left,
    piece.bottom - piece.top,
    gradient,
  );
}

export function backdropMarker(
  piece: TailPiece,
  origin: { left: number; top: number },
  color: string,
): LayerMarker {
  return new BoxMarker(
    "cm-caret-backdrop",
    piece.left - origin.left,
    piece.top - origin.top,
    piece.right - piece.left,
    piece.bottom - piece.top,
    color,
  );
}

function isOpaque(color: string): boolean {
  if (color === "transparent") return false;
  const alpha = /rgba?\([^)]*,\s*([\d.]+)\)/.exec(color);
  return !alpha || Number(alpha[1]) > 0;
}

export function surfaceColor(element: Element): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (isOpaque(color)) return color;
  }
  return "Canvas";
}

export function prefersLightGlyphs(view: EditorView): boolean {
  const channels = getComputedStyle(view.contentDOM).color.match(/[\d.]+/g);
  if (!channels || channels.length < 3) return false;
  const [r, g, b] = channels.slice(0, 3).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 127;
}
