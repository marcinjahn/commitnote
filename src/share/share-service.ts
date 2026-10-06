import { notePathEquals, type NotePath } from "../changes/change";
import type { Argon2idFunction } from "../crypto/argon2";
import { secureRandom, type RandomSource } from "../crypto/random";
import { isForgeError } from "../forge/errors";
import type { ShareHost } from "../forge/share-host";
import type { NoteHistory } from "../history/note-history";
import type { Clock } from "../sync/clock";
import type { RateBudget } from "../sync/rate-budget";
import type {
  SyncEngine,
  SyncEngineState,
  SyncError,
} from "../sync/sync-engine";
import { findWorkingNode } from "../sync/working-tree";
import { findNode } from "../tree/note-tree";
import { sealShare } from "./share-envelope";
import { formatShareLink } from "./share-link";
import { newShareId, type ShareEntry } from "./share-index";

export type ShareError =
  | {
      readonly kind:
        | "permissionMissing"
        | "network"
        | "server"
        | "unauthorized"
        | "notSaved"
        | "tooLarge"
        | "sharesUnavailable";
    }
  | { readonly kind: "rateLimited"; readonly retryAfterMs: number };

export type CreateShareResult =
  | {
      readonly ok: true;
      readonly link: string;
      readonly password: string | null;
      readonly entry: ShareEntry;
    }
  | { readonly ok: false; readonly error: ShareError };

export type RevokeShareResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ShareError };

export interface ShareService {
  /** An empty `password` means no password. */
  createShare(input: {
    readonly path: NotePath;
    readonly password: string;
  }): Promise<CreateShareResult>;
  revokeShare(id: string): Promise<RevokeShareResult>;
}

export interface ShareServiceDeps {
  readonly engine: SyncEngine;
  readonly shareHost: ShareHost;
  readonly noteHistory: NoteHistory;
  readonly rateBudget: RateBudget;
  readonly clock: Clock;
  readonly argon2id: Argon2idFunction;
  readonly linkBase: string;
  readonly random?: RandomSource;
}

const NOT_SAVED: ShareError = { kind: "notSaved" };

export function shareErrorOf(
  error: unknown,
  operation: "create" | "delete",
): ShareError {
  if (!isForgeError(error)) {
    console.error(
      "Share failed",
      error instanceof Error ? error.name : typeof error,
    );
    return { kind: "server" };
  }
  switch (error.kind) {
    case "Forbidden":
      return { kind: "permissionMissing" };
    case "NotFound":
      return operation === "create"
        ? { kind: "permissionMissing" }
        : { kind: "server" };
    case "RateLimited":
      return { kind: "rateLimited", retryAfterMs: error.retryAfterMs ?? 0 };
    case "Network":
      return { kind: "network" };
    case "Unauthorized":
      return { kind: "unauthorized" };
    default:
      return { kind: "server" };
  }
}

function structureErrorOf(kind: string): ShareError {
  return kind === "sharesUnavailable" ? { kind } : NOT_SAVED;
}

export function createShareService(deps: ShareServiceDeps): ShareService {
  const { engine, shareHost, noteHistory, rateBudget, clock, argon2id } = deps;
  const random = deps.random ?? secureRandom;

  function rateLimitWait(): ShareError | null {
    const wait = rateBudget.availableAt(1) - clock.now();
    return wait > 0 ? { kind: "rateLimited", retryAfterMs: wait } : null;
  }

  function savedNoteOf(state: SyncEngineState, path: NotePath) {
    const { synced, workingTree } = state;
    if (synced === null || workingTree === null) return null;
    const working = findWorkingNode(workingTree, path);
    if (working?.kind !== "note" || working.syncedPath === null) return null;
    if (state.conflicts.some((c) => notePathEquals(c.path, path))) return null;
    return { synced, working };
  }

  async function createShare(input: {
    readonly path: NotePath;
    readonly password: string;
  }): Promise<CreateShareResult> {
    const { path, password } = input;
    const fail = (error: ShareError): CreateShareResult => ({
      ok: false,
      error,
    });

    const initial = engine.getState();
    if (initial.synced !== null && !initial.synced.shares.writable) {
      return fail({ kind: "sharesUnavailable" });
    }
    if (savedNoteOf(initial, path) === null) return fail(NOT_SAVED);

    await engine.flush();

    const state = engine.getState();
    const saved = savedNoteOf(state, path);
    if (saved === null || state.syncStates.stateOf(path).kind !== "synced") {
      return fail(NOT_SAVED);
    }
    const { synced, working } = saved;
    const node = findNode(synced.tree, working.syncedPath ?? path);
    if (node?.kind !== "note") return fail(NOT_SAVED);

    const { storedPath, blobSha } = node;
    const failure = (error: SyncError | null): CreateShareResult => {
      if (error?.kind === "rateLimited") {
        return fail({ kind: "rateLimited", retryAfterMs: error.retryAfterMs });
      }
      if (error?.kind === "network" || error?.kind === "unauthorized") {
        return fail({ kind: error.kind });
      }
      return fail({ kind: "server" });
    };
    const newest = await noteHistory.newestVersion(
      working.syncedPath ?? path,
      synced.head,
    );
    if (newest.kind === "none") return fail(NOT_SAVED);
    if (newest.kind === "failed") return failure(newest.error);
    const version = await noteHistory.readVersion(newest.version);
    if (version.kind !== "readable") {
      return failure(version.kind === "failed" ? version.error : null);
    }

    const sharedAt = new Date(clock.now()).toISOString();
    const sealed = await sealShare({
      name: working.name,
      markdown: version.content,
      sharedAt,
      updatedAt: null,
      password: password || undefined,
      random,
      argon2id,
    });
    if (sealed.kind === "tooLarge") return fail({ kind: "tooLarge" });

    const limited = rateLimitWait();
    if (limited !== null) return fail(limited);

    let locator;
    try {
      locator = await shareHost.create(sealed.envelope);
    } catch (error) {
      return fail(shareErrorOf(error, "create"));
    }

    const entry: ShareEntry = {
      id: newShareId(random),
      locator,
      linkSecret: sealed.linkSecret,
      password: password || null,
      name: working.name,
      sharedAt,
      note: { state: "active", path },
      source: { commit: newest.version.sha, storedPath, blobSha },
      updatedAt: null,
    };
    const added = engine.addShare(entry);
    if (!added.ok) {
      try {
        await shareHost.delete(locator);
      } catch {
        // The share stays hosted but unrecorded; nothing more can be done.
      }
      return fail(structureErrorOf(added.error.kind));
    }

    return {
      ok: true,
      link: formatShareLink(deps.linkBase, locator, sealed.linkSecret),
      password: entry.password,
      entry,
    };
  }

  async function revokeShare(id: string): Promise<RevokeShareResult> {
    const state = engine.getState();
    const entry = state.shares?.entries.get(id);
    if (entry === undefined) return { ok: true };
    if (state.synced !== null && !state.synced.shares.writable) {
      return { ok: false, error: { kind: "sharesUnavailable" } };
    }
    const limited = rateLimitWait();
    if (limited !== null) return { ok: false, error: limited };

    try {
      await shareHost.delete(entry.locator);
    } catch (error) {
      return { ok: false, error: shareErrorOf(error, "delete") };
    }
    const removed = engine.removeShare(id);
    if (!removed.ok) {
      return { ok: false, error: structureErrorOf(removed.error.kind) };
    }
    return { ok: true };
  }

  return { createShare, revokeShare };
}
