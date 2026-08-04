import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { decryptNote, NoteDecryptionError } from "../crypto/note-cipher";
import { isForgeError, type ForgeError } from "../forge/errors";
import type { ForgeAdapter, TreeEntry } from "../forge/forge-adapter";
import { buildNoteTree, findNode, type NoteTree } from "../tree/note-tree";
import type { Clock } from "./clock";

export type SyncError =
  | {
      readonly kind:
        | "unauthorized"
        | "forbidden"
        | "notFound"
        | "network"
        | "server"
        | "treeTruncated"
        | "undecryptable";
    }
  | { readonly kind: "rateLimited"; readonly retryAfterMs: number };

export interface SyncedState {
  readonly head: string;
  readonly listing: readonly TreeEntry[];
  readonly tree: NoteTree;
}

export type OpenNoteState =
  | { readonly kind: "loading"; readonly path: NotePath }
  | {
      readonly kind: "loaded";
      readonly path: NotePath;
      readonly blobSha: string;
      readonly content: string;
    }
  | { readonly kind: "missing"; readonly path: NotePath }
  | {
      readonly kind: "failed";
      readonly path: NotePath;
      readonly error: SyncError;
    };

export interface RefreshState {
  readonly inFlight: boolean;
  readonly lastError: SyncError | null;
  readonly lastCompletedAt: number | null;
}

export interface SyncEngineState {
  readonly synced: SyncedState | null;
  readonly refresh: RefreshState;
  readonly openNote: OpenNoteState | null;
}

export interface SyncEngine {
  getState(): SyncEngineState;
  subscribe(run: (state: SyncEngineState) => void): () => void;
  refresh(): Promise<void>;
  openNote(path: NotePath | null): Promise<void>;
  dispose(): void;
}

function mapForgeError(error: ForgeError): SyncError {
  switch (error.kind) {
    case "Unauthorized":
      return { kind: "unauthorized" };
    case "Forbidden":
      return { kind: "forbidden" };
    case "NotFound":
      return { kind: "notFound" };
    case "RateLimited":
      return { kind: "rateLimited", retryAfterMs: error.retryAfterMs ?? 0 };
    case "Network":
      return { kind: "network" };
    case "Server":
      return { kind: "server" };
    case "TreeTruncated":
      return { kind: "treeTruncated" };
  }
}

const INITIAL_STATE: SyncEngineState = {
  synced: null,
  refresh: { inFlight: false, lastError: null, lastCompletedAt: null },
  openNote: null,
};

export function createSyncEngine(options: {
  readonly adapter: ForgeAdapter;
  readonly keyring: Keyring;
  readonly clock: Clock;
}): SyncEngine {
  const { adapter, keyring, clock } = options;

  let state: SyncEngineState = INITIAL_STATE;
  const subscribers = new Set<(state: SyncEngineState) => void>();
  let disposed = false;
  let refreshInFlight: Promise<void> | null = null;
  // Bumped on every openNote() call so a result from an earlier call (or
  // from a refresh reloading the note that was open when it started) can be
  // told apart from the latest request and discarded if it is stale.
  let openNoteEpoch = 0;

  function update(
    updater: (current: SyncEngineState) => SyncEngineState,
  ): void {
    if (disposed) return;
    state = updater(state);
    for (const run of subscribers) {
      run(state);
    }
  }

  function toSyncError(error: unknown): SyncError {
    if (error instanceof NoteDecryptionError) {
      return { kind: "undecryptable" };
    }
    if (isForgeError(error)) {
      return mapForgeError(error);
    }
    throw error;
  }

  function applyOpenNoteResult(epoch: number, next: OpenNoteState): void {
    if (epoch !== openNoteEpoch) return;
    update((current) => ({ ...current, openNote: next }));
  }

  async function fetchAndApplyNote(
    path: NotePath,
    blobSha: string,
    epoch: number,
  ): Promise<void> {
    try {
      const stored = await adapter.readBlob(blobSha);
      const content = await decryptNote(keyring, stored);
      applyOpenNoteResult(epoch, { kind: "loaded", path, blobSha, content });
    } catch (error) {
      applyOpenNoteResult(epoch, {
        kind: "failed",
        path,
        error: toSyncError(error),
      });
    }
  }

  async function resolveOpenNoteForRefresh(
    current: OpenNoteState,
    synced: SyncedState,
    epoch: number,
  ): Promise<void> {
    const path = current.path;
    const node = findNode(synced.tree, path);
    if (node === undefined || node.kind !== "note") {
      applyOpenNoteResult(epoch, { kind: "missing", path });
      return;
    }

    if (current.kind === "loaded" && current.blobSha === node.blobSha) {
      return;
    }

    // Keep showing the previously loaded content while the new blob loads;
    // any other prior state (loading, missing, failed) switches to loading.
    if (current.kind !== "loaded") {
      applyOpenNoteResult(epoch, { kind: "loading", path });
    }

    await fetchAndApplyNote(path, node.blobSha, epoch);
  }

  async function doRefresh(): Promise<void> {
    update((current) => ({
      ...current,
      refresh: { ...current.refresh, inFlight: true },
    }));

    try {
      const head = await adapter.getHead();

      let synced = state.synced;
      if (synced === null || synced.head !== head) {
        const listing = await adapter.listTree(head);
        const tree = await buildNoteTree(listing, keyring);
        synced = { head, listing, tree };
        update((current) => ({ ...current, synced }));
      }

      const openNote = state.openNote;
      if (openNote !== null) {
        await resolveOpenNoteForRefresh(openNote, synced, openNoteEpoch);
      }

      update((current) => ({
        ...current,
        refresh: {
          inFlight: false,
          lastError: null,
          lastCompletedAt: clock.now(),
        },
      }));
    } catch (error) {
      if (isForgeError(error)) {
        update((current) => ({
          ...current,
          refresh: {
            inFlight: false,
            lastError: mapForgeError(error),
            lastCompletedAt: current.refresh.lastCompletedAt,
          },
        }));
        return;
      }
      update((current) => ({
        ...current,
        refresh: { ...current.refresh, inFlight: false },
      }));
      throw error;
    }
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (refreshInFlight !== null) return refreshInFlight;

    const promise = doRefresh().finally(() => {
      if (refreshInFlight === promise) {
        refreshInFlight = null;
      }
    });
    refreshInFlight = promise;
    return promise;
  }

  function openNote(path: NotePath | null): Promise<void> {
    if (disposed) return Promise.resolve();

    const epoch = ++openNoteEpoch;

    if (path === null) {
      update((current) => ({ ...current, openNote: null }));
      return Promise.resolve();
    }

    const tree = state.synced?.tree ?? null;
    const node = tree === null ? undefined : findNode(tree, path);
    if (node === undefined || node.kind !== "note") {
      update((current) => ({
        ...current,
        openNote: { kind: "missing", path },
      }));
      return Promise.resolve();
    }

    update((current) => ({ ...current, openNote: { kind: "loading", path } }));
    return fetchAndApplyNote(path, node.blobSha, epoch);
  }

  function dispose(): void {
    disposed = true;
    subscribers.clear();
  }

  function subscribe(run: (state: SyncEngineState) => void): () => void {
    run(state);
    if (disposed) return () => {};
    subscribers.add(run);
    return () => {
      subscribers.delete(run);
    };
  }

  return {
    getState: () => state,
    subscribe,
    refresh,
    openNote,
    dispose,
  };
}
