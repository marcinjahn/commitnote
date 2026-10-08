import { StateEffect, type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  layer,
  type LayerMarker,
  type ViewUpdate,
} from "@codemirror/view";
import {
  CARET_BLINK_MS,
  CARET_HOLD_MS,
  CARET_SOFT_EDGE,
  CARET_WIDTH_PX,
} from "./caret-style";
import {
  backdropMarker,
  measureTail,
  prefersLightGlyphs,
  surfaceColor,
  tailClusters,
  tintMarker,
  type TailCluster,
} from "./caret-tail";
import { editingModeOf } from "./vim/vim-status";

export type CaretLight = "solid" | "on" | "off";

const CARET_LIGHT_PROPERTY = "--accent-caret-lit";
const OWN_CARET_CLASS = "cm-own-caret";
const FORCED_COLORS = "@media (forced-colors: active)";

const BLINKING_LAYERS = ".cm-accent-caret-layer, .cm-caret-tint-layer";

const compositionChanged = StateEffect.define<null>();

function caretMoved(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.selectionSet ||
    update.focusChanged ||
    editingModeOf(update.startState) !== editingModeOf(update.state) ||
    update.transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(compositionChanged)),
    )
  );
}

export class CaretBlinker {
  light: CaretLight = "solid";
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onChange: (light: CaretLight) => void,
    private readonly reducedMotion: () => boolean,
  ) {}

  restart(): void {
    this.stop();
    if (!this.reducedMotion()) this.schedule(CARET_HOLD_MS, "off");
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.set("solid");
  }

  private schedule(delay: number, next: "on" | "off"): void {
    this.timer = setTimeout(() => {
      this.set(next);
      this.schedule(CARET_BLINK_MS, next === "off" ? "on" : "off");
    }, delay);
  }

  private set(light: CaretLight): void {
    if (light === this.light) return;
    this.light = light;
    this.onChange(light);
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function registerCaretLightProperty(): void {
  try {
    CSS.registerProperty({
      name: CARET_LIGHT_PROPERTY,
      syntax: "<number>",
      inherits: true,
      initialValue: "1",
    });
  } catch {
    // Already registered, or CSS.registerProperty is unavailable (tests).
  }
}

interface CaretPosition {
  head: number;
  assoc: -1 | 1;
  tail: TailCluster[];
}


class AccentCaretState {
  carets: CaretPosition[] = [];
  composing = false;
  readonly blinker: CaretBlinker;

  constructor(readonly view: EditorView) {
    this.blinker = new CaretBlinker((light) => {
      for (const dom of view.scrollDOM.querySelectorAll<HTMLElement>(
        BLINKING_LAYERS,
      ))
        dom.dataset.caret = light;
    }, prefersReducedMotion);
    this.refresh();
  }

  get owned(): boolean {
    const mode = editingModeOf(this.view.state);
    return (
      !this.composing &&
      this.view.state.facet(EditorView.editable) &&
      (mode === null || mode === "insert")
    );
  }

  update(update: ViewUpdate): void {
    if (caretMoved(update)) this.refresh();
  }

  private refresh(): void {
    this.carets =
      this.owned && this.view.hasFocus
        ? this.view.state.selection.ranges
            .filter((range) => range.empty)
            .map((range) => ({
              head: range.head,
              assoc: range.assoc < 0 ? -1 : 1,
              tail: tailClusters(this.view.state, range.head),
            }))
        : [];
    if (this.carets.length > 0) this.blinker.restart();
    else this.blinker.stop();
  }

  destroy(): void {
    this.blinker.stop();
  }
}

class CaretMarker implements LayerMarker {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly height: number,
  ) {}

  eq(other: LayerMarker): boolean {
    return (
      other instanceof CaretMarker &&
      other.left === this.left &&
      other.top === this.top &&
      other.height === this.height
    );
  }

  draw(): HTMLElement {
    const dom = document.createElement("div");
    dom.className = "cm-accent-caret";
    this.place(dom);
    return dom;
  }

  update(dom: HTMLElement, prev: LayerMarker): boolean {
    if (!(prev instanceof CaretMarker)) return false;
    this.place(dom);
    return true;
  }

  private place(dom: HTMLElement): void {
    dom.style.left = `${this.left}px`;
    dom.style.top = `${this.top}px`;
    dom.style.height = `${this.height}px`;
  }
}

function layerOrigin(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect();
  return {
    left: rect.left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  };
}

const snapToDevicePixels = (value: number) =>
  Math.round(value * devicePixelRatio) / devicePixelRatio;

function caretMarkers(
  view: EditorView,
  state: AccentCaretState,
): LayerMarker[] {
  const origin = layerOrigin(view);
  const markers: LayerMarker[] = [];
  for (const caret of state.carets) {
    const coords = view.coordsAtPos(caret.head, caret.assoc);
    if (!coords) continue;
    const left = snapToDevicePixels(coords.left - CARET_WIDTH_PX / 2);
    const top = snapToDevicePixels(coords.top);
    markers.push(
      new CaretMarker(
        left - origin.left,
        top - origin.top,
        snapToDevicePixels(coords.bottom) - top,
      ),
    );
  }
  return markers;
}

function tailLayers(view: EditorView, state: AccentCaretState) {
  const tails = state.carets.filter((caret) =>
    caret.tail.some((cluster) => cluster.ink),
  );
  if (tails.length === 0) return { tints: [], backdrops: [] };
  const origin = layerOrigin(view);
  const backdrop = surfaceColor(view.scrollDOM);
  const blend = prefersLightGlyphs(view) ? "darken" : "lighten";
  const tints: LayerMarker[] = [];
  const backdrops: LayerMarker[] = [];
  for (const caret of tails) {
    for (const piece of measureTail(view, caret.tail)) {
      tints.push(tintMarker(piece, origin, blend));
      backdrops.push(backdropMarker(piece, origin, backdrop));
    }
  }
  return { tints, backdrops };
}

const accentCaretTheme = EditorView.baseTheme({
  ".cm-accent-caret-layer, .cm-caret-tint-layer, .cm-caret-backdrop-layer": {
    pointerEvents: "none",
    [CARET_LIGHT_PROPERTY]: "1",
  },
  ".cm-accent-caret-layer[data-caret=on], .cm-accent-caret-layer[data-caret=off], .cm-caret-tint-layer[data-caret=on], .cm-caret-tint-layer[data-caret=off]":
    { transition: `${CARET_LIGHT_PROPERTY} ${CARET_SOFT_EDGE}` },
  ".cm-accent-caret-layer[data-caret=off], .cm-caret-tint-layer[data-caret=off]":
    { [CARET_LIGHT_PROPERTY]: "0" },
  // A layer's own z-index would isolate its blending from the text below it.
  ".cm-caret-tint-layer": { zIndex: "auto !important" },
  ".cm-caret-tint": { opacity: `var(${CARET_LIGHT_PROPERTY})` },
  ".cm-caret-tint-lighten": { mixBlendMode: "lighten" },
  ".cm-caret-tint-darken": { mixBlendMode: "darken" },
  // A copy of the emoji, clipped to its own glyph, recolours it with the
  // accent's hue while keeping the emoji's shading.
  ".cm-caret-tint-emoji": {
    mixBlendMode: "color",
    whiteSpace: "pre",
    "& > span": {
      backgroundClip: "text",
      "-webkit-background-clip": "text",
      "-webkit-text-fill-color": "transparent",
    },
  },
  ".cm-accent-caret": {
    width: `${CARET_WIDTH_PX}px`,
    background: "var(--color-accent)",
    opacity: `var(${CARET_LIGHT_PROPERTY})`,
  },
  [`.cm-content.${OWN_CARET_CLASS}`]: {
    caretColor: "transparent !important",
  },
  [FORCED_COLORS]: {
    ".cm-accent-caret-layer, .cm-caret-tint-layer, .cm-caret-backdrop-layer": {
      display: "none",
    },
    [`.cm-content.${OWN_CARET_CLASS}`]: { caretColor: "auto !important" },
  },
});

export function accentCaret(): Extension {
  registerCaretLightProperty();

  const plugin = ViewPlugin.fromClass(AccentCaretState, {
    eventHandlers: {
      compositionstart(_event, view) {
        this.composing = true;
        view.dispatch({ effects: compositionChanged.of(null) });
      },
      compositionend(_event, view) {
        this.composing = false;
        setTimeout(() => {
          if (
            view.plugin(plugin) === this &&
            !this.composing &&
            !view.composing
          )
            view.dispatch({ effects: compositionChanged.of(null) });
        });
      },
    },
  });

  const redrawOnCaretMove = (update: ViewUpdate) =>
    caretMoved(update) || update.viewportChanged;
  const syncBlinkingLayer = (update: ViewUpdate, dom: HTMLElement) => {
    const state = update.view.plugin(plugin);
    if (state) dom.dataset.caret = state.blinker.light;
    return redrawOnCaretMove(update);
  };

  return [
    accentCaretTheme,
    plugin,
    layer({
      above: true,
      class: "cm-accent-caret-layer",
      update: syncBlinkingLayer,
      markers: (view) => {
        const state = view.plugin(plugin);
        return state ? caretMarkers(view, state) : [];
      },
    }),
    layer({
      above: true,
      class: "cm-caret-tint-layer",
      update: syncBlinkingLayer,
      markers: (view) => {
        const state = view.plugin(plugin);
        return state ? tailLayers(view, state).tints : [];
      },
    }),
    // Blending needs an opaque surface behind the text inside the scroller.
    layer({
      above: false,
      class: "cm-caret-backdrop-layer",
      update: redrawOnCaretMove,
      markers: (view) => {
        const state = view.plugin(plugin);
        return state ? tailLayers(view, state).backdrops : [];
      },
    }),
    EditorView.contentAttributes.of((view) =>
      view.plugin(plugin)?.owned ? { class: OWN_CARET_CLASS } : null,
    ),
  ];
}
