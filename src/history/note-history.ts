import type { NotePath } from "../changes/change";
import { parseCommitMessage } from "../changes/commit-message";
import type { Keyring } from "../crypto/keyring";
import { decryptName, encryptPath } from "../crypto/name-cipher";
import { decryptNote, NoteDecryptionError } from "../crypto/note-cipher";
import { isForgeError } from "../forge/errors";
import type { CommitSummary, ForgeAdapter } from "../forge/forge-adapter";
import { TRASH_DIR } from "../format/v1";
import { mapForgeError, type SyncError } from "../sync/sync-engine";
import { rewindPath, type RewindStep } from "./rewind-path";

export const HISTORY_PAGE_SIZE = 50;
/** `loadMore` stops once it found this many versions. */
export const HISTORY_MIN_NEW_VERSIONS = 30;
/** Forge requests one `loadMore` may send. */
export const HISTORY_MAX_REQUESTS = 5;
const CONTENT_CACHE_SIZE = 50;
const CURSOR_CACHE_SIZE = 20;

export type VersionEvent =
  | "created"
  | "renamed"
  | "moved"
  | "restoredFromTrash"
  | "passphraseChanged"
  | "external";

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

export interface NoteHistory {
  /**
   * The history of the note at `notePath` on `head`, starting to load when
   * nothing is loaded yet. The same cursor is returned for the same note
   * and head for the rest of the session.
   */
  open(notePath: NotePath, head: string): NoteHistoryCursor;
  readVersion(version: NoteVersion): Promise<VersionContent>;
}

export interface NoteHistoryDeps {
  readonly adapter: Pick<
    ForgeAdapter,
    "listCommits" | "readFileAt" | "listTree"
  >;
  readonly keyring: Keyring;
}

class Lru<V> {
  private readonly entries = new Map<string, V>();
  constructor(private readonly capacity: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }
}

function toSyncError(error: unknown): SyncError {
  if (isForgeError(error)) return mapForgeError(error);
  console.error(
    "Reading note history failed",
    error instanceof Error ? error.name : typeof error,
  );
  return { kind: "server" };
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function eventsOf(step: RewindStep): VersionEvent[] {
  switch (step.kind) {
    case "same":
      return step.external ? ["external"] : [];
    case "moved": {
      const events: VersionEvent[] = [];
      if (step.renamed) events.push("renamed");
      if (step.moved) events.push("moved");
      return events;
    }
    case "created":
      return ["created"];
    case "restored":
      return ["restoredFromTrash"];
    case "passphraseChanged":
      return ["passphraseChanged"];
    case "trashed":
    case "deleted":
      return [];
  }
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

  /** Where the restored note was in the trash before `commit`, or null. */
  async function traceRestore(
    commit: CommitSummary,
    pathAfter: string,
    step: Extract<RewindStep, { kind: "restored" }>,
  ): Promise<string | null> {
    const parent = commit.parents[0];
    if (parent === undefined) return null;
    const file = await readFile(commit.sha, pathAfter);
    if (file === null) return null;
    const listing = await adapter.listTree(parent);
    const rest =
      step.path === step.to ? "" : step.path.slice(step.to.length + 1);
    const entryPrefix = `${TRASH_DIR}/${step.entryId}/`;
    const candidates = listing.filter(
      (entry) =>
        entry.type === "blob" &&
        entry.sha === file.blobSha &&
        entry.path.startsWith(entryPrefix) &&
        (rest === "" || entry.path.endsWith(`/${rest}`)),
    );
    const wanted = lastSegment(step.path);
    const match =
      candidates.find((entry) => lastSegment(entry.path) === wanted) ??
      candidates[0];
    if (match === undefined) return null;

    const before = rewindPath(
      { subject: "", formatVersion: null, trailers: step.earlier },
      match.path,
    );
    switch (before.kind) {
      case "same":
        return match.path;
      case "moved":
      case "trashed":
        return before.before;
      default:
        return null;
    }
  }

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
      step: RewindStep,
    ): Promise<NoteVersion> {
      return {
        sha: commit.sha,
        committedAt: commit.committedAt,
        storedPath: path,
        name: await nameOf(path),
        events: eventsOf(step),
      };
    }

    /** Applies one commit; returns whether the path changed. */
    async function apply(
      commit: CommitSummary,
      path: string,
      found: NoteVersion[],
    ): Promise<{ relocated: boolean; end: HistoryEnd | null }> {
      const step = rewindPath(parseCommitMessage(commit.message), path);
      const parent = commit.parents[0];
      const next = (nextPath: string, relocated: boolean) => {
        storedPath = nextPath;
        if (parent === undefined) {
          return { relocated, end: { kind: "beginning" } as const };
        }
        from = parent;
        return { relocated, end: null };
      };

      switch (step.kind) {
        case "same":
          found.push(await versionFor(commit, path, step));
          return next(path, false);
        case "moved":
          found.push(await versionFor(commit, path, step));
          return next(step.before, true);
        case "trashed":
          return next(step.before, true);
        case "created":
          found.push(await versionFor(commit, path, step));
          return { relocated: false, end: { kind: "created" } };
        case "deleted":
          return { relocated: false, end: { kind: "untraceable" } };
        case "passphraseChanged":
          found.push(await versionFor(commit, path, step));
          return {
            relocated: false,
            end: {
              kind: "passphraseChanged",
              historyDeleted: commit.parents.length === 0,
            },
          };
        case "restored": {
          const version = await versionFor(commit, path, step);
          const source = await traceRestore(commit, path, step);
          found.push(version);
          if (source === null) {
            return { relocated: false, end: { kind: "untraceable" } };
          }
          return next(source, true);
        }
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

  return {
    open(notePath, head) {
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
