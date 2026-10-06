import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { decryptName, encryptPath } from "../crypto/name-cipher";
import { decryptNote, NoteDecryptionError } from "../crypto/note-cipher";
import { isForgeError } from "../forge/errors";
import type { CommitSummary, ForgeAdapter } from "../forge/forge-adapter";
import { mapForgeError, type SyncError } from "../sync/sync-engine";
import { createChainStep, lastSegment, type VersionEvent } from "./chain-step";
import { Lru } from "./lru";

const HISTORY_PAGE_SIZE = 50;
/** `loadMore` stops once it found this many versions. */
const HISTORY_MIN_NEW_VERSIONS = 30;
/** Forge requests one `loadMore` may send. */
export const HISTORY_MAX_REQUESTS = 5;
const CONTENT_CACHE_SIZE = 50;
const CURSOR_CACHE_SIZE = 20;

export type { VersionEvent };

/** The note as a commit left it. */
export interface NoteVersion {
  readonly sha: string;
  readonly committedAt: number;
  readonly storedPath: string;
  /** Null when the name can't be decrypted. */
  readonly name: string | null;
  readonly events: readonly VersionEvent[];
}

export type HistoryEnd =
  | { readonly kind: "created" }
  | { readonly kind: "passphraseChanged"; readonly historyDeleted: boolean }
  | { readonly kind: "beginning" }
  | { readonly kind: "untraceable" };

export interface NoteHistoryState {
  /** Newest first. */
  readonly versions: readonly NoteVersion[];
  /** Null while older versions may exist. */
  readonly end: HistoryEnd | null;
  readonly loading: boolean;
  readonly error: SyncError | null;
}

export interface NoteHistoryCursor {
  getState(): NoteHistoryState;
  /** Calls `run` with the current state right away and on every change. */
  subscribe(run: (state: NoteHistoryState) => void): () => void;
  /** Loads older versions; resolves once done or failed (see `error`). */
  loadMore(): Promise<void>;
  /** Clears the error and loads again. */
  retry(): Promise<void>;
}

export type VersionContent =
  | {
      readonly kind: "readable";
      readonly content: string;
      readonly name: string | null;
    }
  | { readonly kind: "undecryptable"; readonly name: string | null }
  | { readonly kind: "failed"; readonly error: SyncError };

export type NewestVersion =
  | { readonly kind: "found"; readonly version: NoteVersion }
  | { readonly kind: "none" }
  | { readonly kind: "failed"; readonly error: SyncError };

export interface NoteHistory {
  /**
   * The history of the note at `notePath` on `head`, starting to load when
   * nothing is loaded yet. Cursors of the most recently opened notes are
   * kept, so reopening one of them continues where it left off.
   */
  open(notePath: NotePath, head: string): NoteHistoryCursor;
  /** The newest version of the note at `notePath` on `head`. */
  newestVersion(notePath: NotePath, head: string): Promise<NewestVersion>;
  readVersion(version: NoteVersion): Promise<VersionContent>;
}

export interface NoteHistoryDeps {
  readonly adapter: Pick<
    ForgeAdapter,
    "listCommits" | "readFileAt" | "listTree"
  >;
  readonly keyring: Keyring;
}

function toSyncError(error: unknown): SyncError {
  if (isForgeError(error)) return mapForgeError(error);
  console.error(
    "Reading note history failed",
    error instanceof Error ? error.name : typeof error,
  );
  return { kind: "server" };
}

export function createNoteHistory(deps: NoteHistoryDeps): NoteHistory {
  const { adapter, keyring } = deps;
  const texts = new Lru<string>(CONTENT_CACHE_SIZE);
  const blobOfFile = new Lru<string>(CONTENT_CACHE_SIZE * 4);
  const names = new Map<string, Promise<string | null>>();
  const cursors = new Lru<NoteHistoryCursor>(CURSOR_CACHE_SIZE);

  const fileKey = (sha: string, storedPath: string) => `${sha}\0${storedPath}`;

  function nameOf(storedPath: string): Promise<string | null> {
    const segment = lastSegment(storedPath);
    let name = names.get(segment);
    if (name === undefined) {
      name = decryptName(keyring, segment);
      names.set(segment, name);
    }
    return name;
  }

  async function readFile(sha: string, storedPath: string) {
    const file = await adapter.readFileAt(sha, storedPath);
    if (file !== null) {
      blobOfFile.set(fileKey(sha, storedPath), file.blobSha);
      texts.set(file.blobSha, file.text);
    }
    return file;
  }

  const chainStep = createChainStep({
    readFileAt: readFile,
    listTree: (sha) => adapter.listTree(sha),
  });

  function createCursor(notePath: NotePath, head: string): NoteHistoryCursor {
    let state: NoteHistoryState = {
      versions: [],
      end: null,
      loading: false,
      error: null,
    };
    const subscribers = new Set<(state: NoteHistoryState) => void>();
    let storedPath: string | null = null;
    let from: string = head;
    let inFlight: Promise<void> | null = null;

    function update(patch: Partial<NoteHistoryState>): void {
      state = { ...state, ...patch };
      for (const run of subscribers) run(state);
    }

    async function versionFor(
      commit: CommitSummary,
      path: string,
      events: readonly VersionEvent[],
    ): Promise<NoteVersion> {
      return {
        sha: commit.sha,
        committedAt: commit.committedAt,
        storedPath: path,
        name: await nameOf(path),
        events,
      };
    }

    /** Applies one commit; returns whether the path changed. */
    async function apply(
      commit: CommitSummary,
      path: string,
      found: NoteVersion[],
    ): Promise<{ relocated: boolean; end: HistoryEnd | null }> {
      const step = await chainStep(commit, path);
      const parent = commit.parents[0];
      const next = (nextPath: string, relocated: boolean) => {
        storedPath = nextPath;
        if (parent === undefined) {
          return { relocated, end: { kind: "beginning" } as const };
        }
        from = parent;
        return { relocated, end: null };
      };
      if (step.events !== null) {
        found.push(await versionFor(commit, path, step.events));
      }

      switch (step.kind) {
        case "same":
          return next(path, false);
        case "relocated":
          return next(step.previousPath, true);
        case "created":
          return { relocated: false, end: { kind: "created" } };
        case "untraceable":
          return { relocated: false, end: { kind: "untraceable" } };
        case "passphraseChanged":
          return {
            relocated: false,
            end: {
              kind: "passphraseChanged",
              historyDeleted: commit.parents.length === 0,
            },
          };
      }
    }

    async function load(): Promise<void> {
      update({ loading: true, error: null });
      let requests = 0;
      let added = 0;
      try {
        storedPath ??= await encryptPath(keyring, notePath);
        let end: HistoryEnd | null = state.end;
        while (
          end === null &&
          added < HISTORY_MIN_NEW_VERSIONS &&
          requests < HISTORY_MAX_REQUESTS
        ) {
          const path: string = storedPath;
          requests++;
          const page = await adapter.listCommits({
            from,
            path,
            limit: HISTORY_PAGE_SIZE,
          });
          const found: NoteVersion[] = [];
          let relocated = false;
          try {
            for (const commit of page) {
              const result = await apply(commit, storedPath, found);
              if (result.end !== null) end = result.end;
              if (result.relocated || end !== null) {
                relocated = result.relocated;
                break;
              }
            }
          } finally {
            added += found.length;
            update({ versions: [...state.versions, ...found], end });
          }
          if (!relocated && end === null && page.length < HISTORY_PAGE_SIZE) {
            end = { kind: "beginning" };
            update({ end });
          }
        }
        update({ loading: false });
      } catch (error) {
        update({ loading: false, error: toSyncError(error) });
      }
    }

    const cursor: NoteHistoryCursor = {
      getState: () => state,
      subscribe(run) {
        run(state);
        subscribers.add(run);
        return () => {
          subscribers.delete(run);
        };
      },
      loadMore() {
        if (inFlight !== null) return inFlight;
        if (state.end !== null) return Promise.resolve();
        inFlight = load().finally(() => {
          inFlight = null;
        });
        return inFlight;
      },
      retry() {
        return cursor.loadMore();
      },
    };
    return cursor;
  }

  function open(notePath: NotePath, head: string): NoteHistoryCursor {
      const key = JSON.stringify([notePath, head]);
      let cursor = cursors.get(key);
      if (cursor === undefined) {
        cursor = createCursor(notePath, head);
        cursors.set(key, cursor);
      }
      const { versions, end, loading } = cursor.getState();
      if (versions.length === 0 && end === null && !loading) {
        void cursor.loadMore();
      }
      return cursor;
  }

  return {
    open,

    async newestVersion(notePath, head) {
      const cursor = open(notePath, head);
      for (;;) {
        await cursor.loadMore();
        const { versions, end, error } = cursor.getState();
        const [newest] = versions;
        if (newest !== undefined) return { kind: "found", version: newest };
        if (error !== null) return { kind: "failed", error };
        if (end !== null) return { kind: "none" };
      }
    },

    async readVersion(version) {
      const name = await nameOf(version.storedPath);
      const key = fileKey(version.sha, version.storedPath);
      const blobSha = blobOfFile.get(key);
      let text = blobSha === undefined ? undefined : texts.get(blobSha);
      if (text === undefined) {
        try {
          const file = await readFile(version.sha, version.storedPath);
          if (file === null) {
            return { kind: "failed", error: { kind: "notFound" } };
          }
          text = file.text;
        } catch (error) {
          return { kind: "failed", error: toSyncError(error) };
        }
      }
      try {
        return {
          kind: "readable",
          content: await decryptNote(keyring, text),
          name,
        };
      } catch (error) {
        if (error instanceof NoteDecryptionError) {
          return { kind: "undecryptable", name };
        }
        throw error;
      }
    },
  };
}
