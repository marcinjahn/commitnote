import {
  createArchiveImagePreparer,
  readImportArchive,
  type ArchiveImagePreparer,
  type StartedImport,
} from "../app/import-actions";
import type { ImportDestination } from "../import/plan-import";
import type { DroppedNotes } from "../import/read-dropped-files";
import type { NotesArchiveContents } from "../import/read-notes-archive";
import type { ImportArchiveOutcome } from "./api";
import type { AppSession, NativeRunningApp } from "./app-session";
import { notReady } from "./commands/command-context";
import { processHostImage } from "./host-image-codec";
import type { HostServices } from "./host-services";
import { toImportForm } from "./import-view";

export interface HeldDrop {
  readonly entries: DroppedNotes["entries"];
  readonly skipped: DroppedNotes["skipped"];
  readonly destination: ImportDestination;
}

export interface ImportState {
  readonly owner: NativeRunningApp | null;
  archive: {
    readonly fileName: string;
    readonly contents: NotesArchiveContents;
  } | null;
  preparer: ArchiveImagePreparer | null;
  dropped: HeldDrop | null;
  started: StartedImport | null;
  starting: number;
}

const states = new WeakMap<AppSession, ImportState>();
const listeners = new WeakMap<AppSession, Set<() => void>>();

export function importStateOf(app: AppSession): ImportState {
  const owner = app.current();
  let state = states.get(app);
  if (state === undefined || state.owner !== owner) {
    state = {
      owner,
      archive: null,
      preparer: null,
      dropped: null,
      started: null,
      starting: 0,
    };
    states.set(app, state);
  }
  return state;
}

export function onImportStateChanged(
  app: AppSession,
  listener: () => void,
): () => void {
  let set = listeners.get(app);
  if (set === undefined) {
    set = new Set();
    listeners.set(app, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}

export function notifyImportState(app: AppSession): void {
  for (const listener of [...(listeners.get(app) ?? [])]) listener();
}

export function archiveImagePreparer(
  state: ImportState,
  owner: NativeRunningApp,
  host: HostServices,
): ArchiveImagePreparer {
  state.preparer ??= createArchiveImagePreparer({
    keyring: owner.session.keyring,
    process: async () => (input, profile) =>
      processHostImage(host.imageCodec, input, profile),
  });
  return state.preparer;
}

export async function openImportArchive(
  app: AppSession,
  host: HostServices,
  bytes: Uint8Array,
  fileName: string,
): Promise<ImportArchiveOutcome> {
  const owner = app.current();
  const tree = owner?.engine.getState().workingTree ?? null;
  if (owner === null || tree === null) throw notReady();
  const archive = readImportArchive(bytes);
  if (!archive.ok) return { kind: "error", message: archive.message };
  const state = importStateOf(app);
  state.archive = { fileName, contents: archive.contents };
  state.dropped = null;
  archiveImagePreparer(state, owner, host).reset();
  return {
    kind: "ready",
    form: toImportForm(fileName, archive.contents, tree),
  };
}
