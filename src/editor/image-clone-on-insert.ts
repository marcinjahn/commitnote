import {
  Annotation,
  type AnnotationType,
  type ChangeSpec,
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { ImageId } from "../images/image-id";
import {
  type ImageReference,
  parseImageReferences,
  referencedImageIds,
  rewriteImageReferences,
} from "../images/image-reference";

export interface ImageCloning {
  owns(imageId: ImageId): boolean;
  clone(imageId: ImageId): Promise<ImageId | null>;
}

export const imageCloning: Facet<ImageCloning, ImageCloning | null> =
  Facet.define<ImageCloning, ImageCloning | null>({
    combine: (values) => values[0] ?? null,
  });

export const imageCloneExempt: AnnotationType<boolean> =
  Annotation.define<boolean>();

interface Candidate {
  readonly from: number;
  readonly to: number;
  readonly imageId: ImageId;
}

interface Batch {
  readonly id: number;
  readonly candidates: readonly Candidate[];
  readonly joinsInsertUndo: boolean;
}

const finishBatch = StateEffect.define<number>();

// The history extension always merges an "input.type.compose" event into the
// previous one. A rewrite with addToHistory false would survive undoing the
// insert (its new text is mapped, not removed), so while the insert is still
// the latest history event, the rewrite joins it instead.
const JOIN_PREVIOUS_USER_EVENT = "input.type.compose";

let nextBatchId = 0;

function isConsidered(tr: Transaction): boolean {
  return (
    tr.docChanged &&
    tr.annotation(imageCloneExempt) !== true &&
    tr.annotation(Transaction.userEvent) !== "set" &&
    !tr.isUserEvent("undo") &&
    !tr.isUserEvent("redo") &&
    !tr.isUserEvent("delete")
  );
}

function findCandidates(tr: Transaction): Candidate[] {
  const cloning = tr.startState.facet(imageCloning);
  if (!cloning || tr.startState.readOnly) return [];

  const inserted: { from: number; to: number }[] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    inserted.push({ from: fromB, to: toB });
  });

  const newText = tr.newDoc.toString();
  if (!newText.includes("image:")) return [];
  const touched = parseImageReferences(newText).filter((reference) =>
    inserted.some(
      (range) => reference.from <= range.to && reference.to >= range.from,
    ),
  );
  if (touched.length === 0) return [];

  const present = referencedImageIds(tr.startState.doc.toString());
  return touched
    .filter(
      (reference) =>
        !present.has(reference.imageId) && !cloning.owns(reference.imageId),
    )
    .map(({ from, to, imageId }) => ({ from, to, imageId }));
}

const pendingClones = StateField.define<readonly Batch[]>({
  create: () => [],
  update(batches, tr) {
    let next = batches;
    if (tr.docChanged && next.length > 0) {
      const addsHistoryEvent =
        tr.annotation(Transaction.addToHistory) !== false &&
        !tr.effects.some((effect) => effect.is(finishBatch));
      next = next.map((batch) => ({
        id: batch.id,
        joinsInsertUndo: batch.joinsInsertUndo && !addsHistoryEvent,
        candidates: batch.candidates.map((candidate) => ({
          from: tr.changes.mapPos(candidate.from, 1),
          to: tr.changes.mapPos(candidate.to, -1),
          imageId: candidate.imageId,
        })),
      }));
    }
    for (const effect of tr.effects) {
      if (effect.is(finishBatch)) {
        next = next.filter((batch) => batch.id !== effect.value);
      }
    }
    if (isConsidered(tr)) {
      const candidates = findCandidates(tr);
      if (candidates.length > 0) {
        next = [
          ...next,
          {
            id: nextBatchId++,
            candidates,
            joinsInsertUndo: tr.annotation(Transaction.addToHistory) !== false,
          },
        ];
      }
    }
    return next;
  },
});

function idOffset(
  text: string,
  reference: ImageReference,
  replacement: ImageId,
): number | null {
  const original = text.slice(reference.from, reference.to);
  const rewritten = rewriteImageReferences(
    original,
    new Map([[reference.imageId, replacement]]),
  );
  for (let index = 0; index < original.length; index++) {
    if (original[index] !== rewritten[index]) {
      return reference.from + index;
    }
  }
  return null;
}

function rewriteChanges(
  state: EditorState,
  batch: Batch,
  clones: ReadonlyMap<ImageId, ImageId | null>,
): ChangeSpec[] {
  const text = state.doc.toString();
  const references = parseImageReferences(text);
  const changes: ChangeSpec[] = [];
  for (const candidate of batch.candidates) {
    const replacement = clones.get(candidate.imageId);
    if (!replacement) continue;
    const reference = references.find(
      (found) =>
        found.from === candidate.from &&
        found.to === candidate.to &&
        found.imageId === candidate.imageId,
    );
    if (!reference) continue;
    const from = idOffset(text, reference, replacement);
    if (from === null) continue;
    changes.push({
      from,
      to: from + candidate.imageId.length,
      insert: replacement,
    });
  }
  return changes;
}

async function cloneAll(
  cloning: ImageCloning,
  imageIds: readonly ImageId[],
): Promise<Map<ImageId, ImageId | null>> {
  const results = await Promise.all(
    imageIds.map((imageId) =>
      cloning.clone(imageId).then(
        (clone) => clone,
        () => null,
      ),
    ),
  );
  return new Map(imageIds.map((imageId, index) => [imageId, results[index]]));
}

const cloneRunner = ViewPlugin.fromClass(
  class {
    private destroyed = false;
    private readonly started = new Set<number>();

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate): void {
      const cloning = update.state.facet(imageCloning);
      for (const batch of update.state.field(pendingClones)) {
        if (this.started.has(batch.id)) continue;
        this.started.add(batch.id);
        if (cloning) this.run(cloning, batch.id, batch.candidates);
      }
    }

    private async run(
      cloning: ImageCloning,
      batchId: number,
      candidates: readonly Candidate[],
    ): Promise<void> {
      const imageIds = [...new Set(candidates.map((c) => c.imageId))];
      const clones = await cloneAll(cloning, imageIds);
      this.started.delete(batchId);
      if (this.destroyed) return;
      const batch = this.view.state
        .field(pendingClones)
        .find((found) => found.id === batchId);
      if (!batch) return;
      this.view.dispatch({
        changes: rewriteChanges(this.view.state, batch, clones),
        effects: finishBatch.of(batchId),
        annotations: [
          batch.joinsInsertUndo
            ? Transaction.userEvent.of(JOIN_PREVIOUS_USER_EVENT)
            : Transaction.addToHistory.of(false),
          imageCloneExempt.of(true),
        ],
      });
    }

    destroy(): void {
      this.destroyed = true;
    }
  },
);

export function imageCloneOnInsert(): Extension {
  return [pendingClones, cloneRunner];
}
