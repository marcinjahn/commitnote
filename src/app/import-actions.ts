import { notePathEquals, type NotePath } from "../changes/change";
import {
  prepareImportImages,
  type ImportImagesDeps,
  type ImportImagesResult,
} from "../import/import-images";
import {
  planImport,
  type CollisionPolicy,
  type ImportDestination,
  type ImportPlan,
  type ImportSummary,
} from "../import/plan-import";
import type { DropSkipCounts } from "../import/read-dropped-files";
import {
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  NotesArchiveError,
  readNotesArchive,
  type ArchiveImportEntry,
  type NotesArchiveContents,
} from "../import/read-notes-archive";
import type { PendingImage } from "../images/pending-image";
import type { SyncEngine, SyncEngineState } from "../sync/sync-engine";
import { findWorkingNode } from "../sync/working-tree";
import {
  describeArchiveError,
  describeEnableAtomicFailure,
  describeFileDropDone,
  describeImportDone,
  describeImportRefusal,
  describeImportUnreachable,
  IMPORT_DESTINATION_GONE_MESSAGE,
  IMPORT_IMAGES_FAILED_MESSAGE,
  IMPORT_MIXED_FILES_MESSAGE,
  type ImportedImageCounts,
} from "../ui/import/import-messages";
import type { ImportOutcome } from "../ui/import/import-outcome";
import { describeUndoneFileDrop } from "../ui/trash/trash-messages";

export type ImportFilesRoute =
  | { readonly kind: "archive"; readonly index: number }
  | { readonly kind: "notes" }
  | { readonly kind: "error"; readonly message: string };

function isZip(file: { readonly name: string }): boolean {
  return file.name.toLowerCase().endsWith(".zip");
}

export function routeImportFiles(
  files: readonly { readonly name: string }[],
): ImportFilesRoute {
  if (files.length === 1 && isZip(files[0]))
    return { kind: "archive", index: 0 };
  if (files.some(isZip)) {
    return { kind: "error", message: IMPORT_MIXED_FILES_MESSAGE };
  }
  return { kind: "notes" };
}

/** Lets a caller refuse an oversized archive before reading its bytes. */
export function checkImportArchiveSize(size: number): string | null {
  return size > MAX_ARCHIVE_UNCOMPRESSED_BYTES
    ? describeArchiveError("tooLarge")
    : null;
}

export type ReadImportArchiveResult =
  | { readonly ok: true; readonly contents: NotesArchiveContents }
  | { readonly ok: false; readonly message: string };

export function readImportArchive(bytes: Uint8Array): ReadImportArchiveResult {
  const tooLarge = checkImportArchiveSize(bytes.byteLength);
  if (tooLarge !== null) return { ok: false, message: tooLarge };
  try {
    return { ok: true, contents: readNotesArchive(bytes) };
  } catch (error) {
    return {
      ok: false,
      message: describeArchiveError(
        error instanceof NotesArchiveError ? error.kind : "invalidArchive",
      ),
    };
  }
}

export type QueuedImportPlan = Extract<ImportPlan, { ok: true }>;

export interface CommitImportDeps {
  readonly engine: Pick<
    SyncEngine,
    "atomicCommitSupport" | "getState" | "addPendingImage" | "importChanges"
  >;
  readonly forgeName: string;
}

export interface CommitImportRequest {
  readonly destination: ImportDestination;
  readonly entries: readonly ArchiveImportEntry[];
  readonly policy: CollisionPolicy;
  readonly images?: readonly PendingImage[];
}

export interface CommitImportResult {
  readonly outcome: ImportOutcome;
  /** Set only when the outcome is `queued`. */
  readonly plan: QueuedImportPlan | null;
}

function notQueued(outcome: ImportOutcome): CommitImportResult {
  return { outcome, plan: null };
}

export async function commitImport(
  deps: CommitImportDeps,
  request: CommitImportRequest,
): Promise<CommitImportResult> {
  const { engine } = deps;
  const { destination, entries, policy, images = [] } = request;
  try {
    const support = await engine.atomicCommitSupport();
    if (support.kind === "needsSetup") {
      return notQueued({
        kind: "needsSetup",
        canConfigure: support.canConfigure,
      });
    }
  } catch {
    return notQueued({
      kind: "error",
      message: describeImportUnreachable(deps.forgeName),
    });
  }
  // A save before the import can change the tree, so the plan is redone once
  // when it no longer applies.
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = engine.getState().workingTree;
    if (current === null) {
      return notQueued({
        kind: "error",
        message: describeImportRefusal("unavailable"),
      });
    }
    let plan: ImportPlan;
    try {
      plan = planImport(current, destination, entries, policy);
    } catch {
      return notQueued({
        kind: "error",
        message: IMPORT_DESTINATION_GONE_MESSAGE,
      });
    }
    if (!plan.ok)
      return notQueued({ kind: "conflicts", count: plan.conflicts });
    for (const image of images) engine.addPendingImage(image);
    const result = await engine.importChanges(plan.changes);
    if (result.ok) return { outcome: { kind: "queued" }, plan };
    if (result.reason !== "outdated") {
      return notQueued({
        kind: "error",
        message: describeImportRefusal(result.reason),
      });
    }
  }
  return notQueued({
    kind: "error",
    message: describeImportRefusal("outdated"),
  });
}

export type PrepareArchiveImagesResult =
  | { readonly ok: true; readonly prepared: ImportImagesResult }
  | { readonly ok: false; readonly message: string };

export interface ArchiveImagePreparer {
  prepare(contents: NotesArchiveContents): Promise<PrepareArchiveImagesResult>;
  reset(): void;
}

export function createArchiveImagePreparer(
  deps: ImportImagesDeps,
): ArchiveImagePreparer {
  let memo: {
    readonly contents: NotesArchiveContents;
    readonly prepared: ImportImagesResult;
  } | null = null;
  return {
    async prepare(contents) {
      if (memo?.contents === contents)
        return { ok: true, prepared: memo.prepared };
      try {
        const prepared = await prepareImportImages(
          contents.entries,
          contents.images,
          deps,
        );
        memo = { contents, prepared };
        return { ok: true, prepared };
      } catch {
        return { ok: false, message: IMPORT_IMAGES_FAILED_MESSAGE };
      }
    },
    reset() {
      memo = null;
    },
  };
}

export interface EnableAtomicCommitsDeps {
  readonly engine: Pick<SyncEngine, "enableAtomicCommits">;
  readonly forgeName: string;
}

/** Resolves to an error message, or `null` once atomic commits are available. */
export async function enableAtomicCommits(
  deps: EnableAtomicCommitsDeps,
): Promise<string | null> {
  try {
    const support = await deps.engine.enableAtomicCommits();
    return support.kind === "available"
      ? null
      : describeEnableAtomicFailure(deps.forgeName);
  } catch {
    return describeEnableAtomicFailure(deps.forgeName);
  }
}

export function importExpandPath(
  destination: ImportDestination,
  plan: QueuedImportPlan,
): NotePath | null {
  if (destination.kind === "folder") return destination.path;
  const first = plan.changes[0];
  if (destination.kind === "new-folder" && first !== undefined) {
    return first.kind === "create-folder" ? first.path : [];
  }
  return null;
}

export function importedNotePaths(plan: QueuedImportPlan): NotePath[] {
  return plan.changes.flatMap((change) =>
    change.kind === "create-note" ? [change.path] : [],
  );
}

export interface StartedImport {
  readonly summary: ImportSummary;
  readonly retryingShown: boolean;
  readonly images?: ImportedImageCounts;
  readonly fileDrop?: {
    readonly paths: readonly NotePath[];
    readonly skipped: DropSkipCounts;
  };
}

export type ImportCompletion =
  | { readonly kind: "none" }
  | { readonly kind: "cleared" }
  | { readonly kind: "retrying" }
  | {
      readonly kind: "done";
      readonly tone: "success";
      readonly message: string;
      readonly undoPaths: readonly NotePath[] | null;
    };

export function importCompletion(
  started: StartedImport | null,
  engine: Pick<
    SyncEngineState,
    "importing" | "save" | "stopped" | "atomicBlocked"
  >,
): ImportCompletion {
  if (started === null) return { kind: "none" };
  if (engine.stopped !== null) return { kind: "cleared" };
  if (!engine.importing) {
    const { fileDrop } = started;
    return fileDrop === undefined
      ? {
          kind: "done",
          tone: "success",
          message: describeImportDone(
            started.summary.notes,
            started.summary.folders,
            started.images,
          ),
          undoPaths: null,
        }
      : {
          kind: "done",
          tone: "success",
          message: describeFileDropDone(
            fileDrop.paths.length,
            fileDrop.skipped,
          ),
          undoPaths: fileDrop.paths,
        };
  }
  if (
    !started.retryingShown &&
    engine.atomicBlocked === null &&
    engine.save.kind === "waiting" &&
    engine.save.reason === "failed"
  ) {
    return { kind: "retrying" };
  }
  return { kind: "none" };
}

export interface UndoFileDropDeps {
  readonly engine: Pick<SyncEngine, "getState" | "delete">;
}

export interface UndoFileDropResult {
  readonly message: string | null;
  readonly affectsOpenNote: boolean;
}

export function undoFileDrop(
  deps: UndoFileDropDeps,
  paths: readonly NotePath[],
  shareCountWithin: (path: NotePath) => number,
  openPath: NotePath | null,
): UndoFileDropResult {
  const { engine } = deps;
  let trashed = 0;
  let kept = 0;
  let affectsOpenNote = false;
  for (const path of paths) {
    const current = engine.getState().workingTree;
    if (current === null || findWorkingNode(current, path)?.kind !== "note")
      continue;
    if (shareCountWithin(path) > 0) {
      kept++;
      continue;
    }
    if (!engine.delete(path).ok) continue;
    trashed++;
    if (openPath !== null && notePathEquals(openPath, path))
      affectsOpenNote = true;
  }
  return {
    message:
      trashed > 0 || kept > 0 ? describeUndoneFileDrop(trashed, kept) : null,
    affectsOpenNote,
  };
}
