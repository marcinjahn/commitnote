import { notePathEquals, type NotePath } from "../changes/change";
import type { Argon2idFunction } from "../crypto/argon2";
import { secureRandom, type RandomSource } from "../crypto/random";
import { isForgeError } from "../forge/errors";
import type { ShareHost } from "../forge/share-host";
import type { NoteHistory, NoteVersion } from "../history/note-history";
import type { Clock } from "../sync/clock";
import type { RateBudget } from "../sync/rate-budget";
import type {
  SyncEngine,
  SyncEngineState,
  SyncError,
} from "../sync/sync-engine";
import { findWorkingNode } from "../sync/working-tree";
import { findNode } from "../tree/note-tree";
import { sealShare, ShareOpenError } from "./share-envelope";
import { formatShareLink } from "./share-link";
import {
  newShareId,
  sharesWithin,
  type ShareEntry,
} from "./share-index";

export type ShareError =
  | {
      readonly kind:
        | "permissionMissing"
        | "network"
        | "server"
        | "unauthorized"
        | "notSaved"
        | "tooLarge"
        | "sharesUnavailable"
        | "shareMissing";
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

export type RevokeSharesResult =
  | { readonly ok: true; readonly revoked: number }
  | {
      readonly ok: false;
      readonly error: ShareError;
      readonly revoked: number;
    };

export type UpdateShareResult =
  | {
      readonly ok: true;
      readonly entry: ShareEntry;
      readonly unchanged: boolean;
    }
  | { readonly ok: false; readonly error: ShareError };

export interface ShareService {
  /** An empty `password` means no password. */
  createShare(input: {
    readonly path: NotePath;
    readonly password: string;
  }): Promise<CreateShareResult>;
  updateShare(id: string): Promise<UpdateShareResult>;
  revokeShare(id: string): Promise<RevokeShareResult>;
  /**
   * Revokes every share of the notes at or within `path`, one by one,
   * stopping at the first failure. Shares revoked before a failure stay
   * revoked.
   */
  revokeShares(path: NotePath): Promise<RevokeSharesResult>;
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
  operation: "create" | "update" | "delete",
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
      if (operation === "create") return { kind: "permissionMissing" };
      return operation === "update"
        ? { kind: "shareMissing" }
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

  function syncErrorOf(error: SyncError | null): ShareError {
    if (error?.kind === "rateLimited") {
      return { kind: "rateLimited", retryAfterMs: error.retryAfterMs };
    }
    if (error?.kind === "network" || error?.kind === "unauthorized") {
      return { kind: error.kind };
    }
    return { kind: "server" };
  }

  async function locateVersion(
    saved: NonNullable<ReturnType<typeof savedNoteOf>>,
    path: NotePath,
  ): Promise<
    | {
        readonly ok: true;
        readonly version: NoteVersion;
        readonly storedPath: string;
        readonly blobSha: string;
      }
    | { readonly ok: false; readonly error: ShareError }
  > {
    const { synced, working } = saved;
    const syncedPath = working.syncedPath ?? path;
    const node = findNode(synced.tree, syncedPath);
    if (node?.kind !== "note") return { ok: false, error: NOT_SAVED };

    const newest = await noteHistory.newestVersion(syncedPath, synced.head);
    if (newest.kind === "none") return { ok: false, error: NOT_SAVED };
    if (newest.kind === "failed") {
      return { ok: false, error: syncErrorOf(newest.error) };
    }
    return {
      ok: true,
      version: newest.version,
      storedPath: node.storedPath,
      blobSha: node.blobSha,
    };
  }

  async function readContent(
    version: NoteVersion,
  ): Promise<
    | { readonly ok: true; readonly content: string }
    | { readonly ok: false; readonly error: ShareError }
  > {
    const read = await noteHistory.readVersion(version);
    if (read.kind === "readable") return { ok: true, content: read.content };
    return {
      ok: false,
      error: syncErrorOf(read.kind === "failed" ? read.error : null),
    };
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
    const { working } = saved;
    const located = await locateVersion(saved, path);
    if (!located.ok) return fail(located.error);
    const { version, storedPath, blobSha } = located;
    const read = await readContent(version);
    if (!read.ok) return fail(read.error);

    const sharedAt = new Date(clock.now()).toISOString();
    const sealed = await sealShare({
      name: working.name,
      markdown: read.content,
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
      label: null,
      sharedAt,
      note: { state: "active", path },
      source: { commit: version.sha, storedPath, blobSha },
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

  async function updateShare(id: string): Promise<UpdateShareResult> {
    const fail = (error: ShareError): UpdateShareResult => ({
      ok: false,
      error,
    });

    const initial = engine.getState();
    if (initial.synced !== null && !initial.synced.shares.writable) {
      return fail({ kind: "sharesUnavailable" });
    }
    const entry = initial.shares?.entries.get(id);
    if (entry === undefined || entry.note.state !== "active") {
      return fail(NOT_SAVED);
    }
    const path = entry.note.path;
    if (savedNoteOf(initial, path) === null) return fail(NOT_SAVED);

    await engine.flush();

    const state = engine.getState();
    const saved = savedNoteOf(state, path);
    if (saved === null || state.syncStates.stateOf(path).kind !== "synced") {
      return fail(NOT_SAVED);
    }
    const located = await locateVersion(saved, path);
    if (!located.ok) return fail(located.error);
    const { version, storedPath, blobSha } = located;
    if (version.sha === entry.source?.commit) {
      return { ok: true, entry, unchanged: true };
    }
    const read = await readContent(version);
    if (!read.ok) return fail(read.error);

    const name = saved.working.name;
    const updatedAt = new Date(clock.now()).toISOString();
    let sealed;
    try {
      sealed = await sealShare({
        name,
        markdown: read.content,
        sharedAt: entry.sharedAt,
        updatedAt,
        password: entry.password ?? undefined,
        linkSecret: entry.linkSecret,
        random,
        argon2id,
      });
    } catch (error) {
      if (error instanceof ShareOpenError) return fail({ kind: "server" });
      throw error;
    }
    if (sealed.kind === "tooLarge") return fail({ kind: "tooLarge" });

    const limited = rateLimitWait();
    if (limited !== null) return fail(limited);

    try {
      await shareHost.update(entry.locator, sealed.envelope);
    } catch (error) {
      return fail(shareErrorOf(error, "update"));
    }

    const updated: ShareEntry = {
      ...entry,
      name,
      updatedAt,
      source: { commit: version.sha, storedPath, blobSha },
    };
    const changed = engine.updateShare(updated);
    if (!changed.ok) return fail(NOT_SAVED);
    return { ok: true, entry: updated, unchanged: false };
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

  async function revokeShares(path: NotePath): Promise<RevokeSharesResult> {
    const attempted = new Set<string>();
    let revoked = 0;
    for (;;) {
      const { shares } = engine.getState();
      const next = shares === null ? undefined : sharesWithin(shares, path)[0];
      if (next === undefined) return { ok: true, revoked };
      if (attempted.has(next.id)) {
        return { ok: false, error: { kind: "server" }, revoked };
      }
      attempted.add(next.id);
      const result = await revokeShare(next.id);
      if (!result.ok) return { ok: false, error: result.error, revoked };
      revoked += 1;
    }
  }

  return { createShare, updateShare, revokeShare, revokeShares };
}
