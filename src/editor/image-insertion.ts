import {
  EditorSelection,
  type Extension,
  Facet,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { PendingImage } from "../images/pending-image";
import type { PrepareImagesOutcome } from "../images/prepare-images";
import { formatImageReference } from "../images/image-reference";
import { imageCloneExempt } from "./image-clone-on-insert";

export interface ImageInsertionConfig {
  prepare(files: readonly File[]): Promise<PrepareImagesOutcome>;
  register(image: PendingImage): void;
  enabled(): boolean;
  onBusy(busy: boolean, count: number): void;
  onOutcome(outcome: PrepareImagesOutcome): void;
}

const BUSY_DELAY_MS = 300;
const SINGLE_IMG_HTML = /^\s*(<meta[^>]*>\s*)?<img\b[^>]*>\s*$/i;

const addAnchor = StateEffect.define<{ token: number; pos: number }>();
const removeAnchor = StateEffect.define<number>();
const clearAnchors = StateEffect.define<null>();

const anchors = StateField.define<ReadonlyMap<number, number>>({
  create: () => new Map(),
  update(value, tr) {
    let next = value;
    if (tr.docChanged && next.size > 0) {
      next = new Map(
        [...next].map(([token, pos]) => [token, tr.changes.mapPos(pos, 1)]),
      );
    }
    for (const effect of tr.effects) {
      if (effect.is(addAnchor)) {
        next = new Map(next).set(effect.value.token, effect.value.pos);
      } else if (effect.is(removeAnchor) && next.has(effect.value)) {
        const copy = new Map(next);
        copy.delete(effect.value);
        next = copy;
      } else if (effect.is(clearAnchors) && next.size > 0) {
        next = new Map();
      }
    }
    return next;
  },
});

const abandonedTokens = new Set<number>();

const abandonOnDestroy = ViewPlugin.define((view) => ({
  destroy() {
    for (const token of view.state.field(anchors, false)?.keys() ?? []) {
      abandonedTokens.add(token);
    }
  },
}));

export const imageInsertion: Facet<
  ImageInsertionConfig,
  ImageInsertionConfig | null
> = Facet.define<ImageInsertionConfig, ImageInsertionConfig | null>({
  combine: (values) => values[0] ?? null,
  enables: [anchors, abandonOnDestroy],
});

let nextToken = 0;

function acceptingConfig(view: EditorView): ImageInsertionConfig | null {
  const { state } = view;
  const config = state.facet(imageInsertion);
  if (!config || state.readOnly || !state.facet(EditorView.editable)) {
    return null;
  }
  return config.enabled() ? config : null;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function imageFilesIn(files: FileList | null | undefined): File[] | null {
  const list = Array.from(files ?? []);
  return list.some(isImageFile) ? list : null;
}

function isRichTextClipboard(data: DataTransfer): boolean {
  const text = data.getData("text/plain");
  const html = data.getData("text/html");
  return text.trim() !== "" && html !== "" && !SINGLE_IMG_HTML.test(html);
}

function failedOutcome(files: readonly File[]): PrepareImagesOutcome {
  return {
    kind: "prepared",
    images: [],
    rejections: files.map(() => ({ kind: "unsupported" }) as const),
    total: files.length,
  };
}

async function prepareWithBusySignal(
  config: ImageInsertionConfig,
  files: readonly File[],
): Promise<PrepareImagesOutcome> {
  let busy = false;
  const timer = setTimeout(() => {
    busy = true;
    config.onBusy(true, files.length);
  }, BUSY_DELAY_MS);
  try {
    return await config.prepare(files);
  } catch {
    return failedOutcome(files);
  } finally {
    clearTimeout(timer);
    if (busy) config.onBusy(false, files.length);
  }
}

function insertReferences(
  view: EditorView,
  token: number,
  pos: number,
  images: readonly PendingImage[],
): void {
  const { state } = view;
  const line = state.doc.lineAt(pos);
  const references = images.map((image) =>
    formatImageReference({
      imageId: image.imageId,
      alt: "",
      width: image.width,
      height: image.height,
    }),
  );
  const insert =
    (pos === line.from ? "" : "\n") +
    references.join("\n") +
    (pos === line.to ? "" : "\n");
  const changes = state.changes({ from: pos, insert });
  const main = state.selection.main;
  let selection = state.selection.map(changes);
  if (main.empty && main.head === pos) {
    selection = selection.replaceRange(
      EditorSelection.cursor(pos + insert.length),
      selection.mainIndex,
    );
  }
  view.dispatch({
    changes,
    selection,
    effects: removeAnchor.of(token),
    userEvent: "input",
    annotations: imageCloneExempt.of(true),
    scrollIntoView: true,
  });
}

async function run(
  view: EditorView,
  config: ImageInsertionConfig,
  token: number,
  files: readonly File[],
): Promise<void> {
  const outcome = await prepareWithBusySignal(config, files);
  if (abandonedTokens.delete(token)) return;
  const pos = view.state.field(anchors, false)?.get(token);
  if (pos === undefined) return;
  const current = acceptingConfig(view);
  if (current && outcome.kind === "prepared" && outcome.images.length > 0) {
    for (const image of outcome.images) current.register(image);
    insertReferences(view, token, pos, outcome.images);
  } else {
    view.dispatch({ effects: removeAnchor.of(token) });
  }
  current?.onOutcome(outcome);
}

export function insertImageFiles(
  view: EditorView,
  files: readonly File[],
  position?: number,
): boolean {
  const config = acceptingConfig(view);
  if (!config) return false;
  const length = view.state.doc.length;
  const pos = Math.min(
    Math.max(position ?? view.state.selection.main.head, 0),
    length,
  );
  const token = nextToken++;
  view.dispatch({ effects: addAnchor.of({ token, pos }) });
  void run(view, config, token, files);
  return true;
}

export function cancelImageInsertions(view: EditorView): void {
  if (view.state.field(anchors, false)?.size) {
    view.dispatch({ effects: clearAnchors.of(null) });
  }
}

export function imageFileHandlers(): Extension {
  return [
    anchors,
    abandonOnDestroy,
    Prec.high(
      EditorView.domEventHandlers({
        paste(event, view) {
          const data = event.clipboardData;
          if (!data) return false;
          const files = imageFilesIn(data.files);
          if (!files || isRichTextClipboard(data)) return false;
          event.preventDefault();
          insertImageFiles(view, files);
          return true;
        },
        dragover(event, view) {
          const data = event.dataTransfer;
          if (!data?.types.includes("Files") || !acceptingConfig(view)) {
            return false;
          }
          event.preventDefault();
          data.dropEffect = "copy";
          return true;
        },
        drop(event, view) {
          const files = imageFilesIn(event.dataTransfer?.files);
          if (!files) return false;
          event.preventDefault();
          const pos =
            view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
            view.state.selection.main.head;
          insertImageFiles(view, files, pos);
          return true;
        },
      }),
    ),
  ];
}
