import type { Change, NotePath } from "../changes/change";
import { isAtOrWithin, notePathEquals } from "../changes/change";
import { toBase64Url } from "../crypto/base64";
import type { Keyring } from "../crypto/keyring";
import { decryptNote, encryptNote } from "../crypto/note-cipher";
import { secureRandom, type RandomSource } from "../crypto/random";
import type { TreeEntry } from "../forge/forge-adapter";
import type { ShareLocator } from "../forge/share-host";
import { SHARES_PATH } from "../format/v1";

const SHARE_FORMAT_VERSION = 1;

export type ShareNoteLocation =
  | { readonly state: "active"; readonly path: NotePath }
  | {
      readonly state: "trashed";
      readonly entryId: string;
      readonly path: NotePath;
    }
  | { readonly state: "deleted" };

export interface ShareSource {
  readonly commit: string;
  readonly storedPath: string;
  readonly blobSha: string;
}

export interface ShareEntry {
  readonly id: string;
  readonly locator: ShareLocator;
  readonly linkSecret: string;
  readonly password: string | null;
  readonly name: string;
  readonly sharedAt: string;
  readonly note: ShareNoteLocation;
  readonly source: ShareSource | null;
  readonly updatedAt: string | null;
}

export interface ShareIndex {
  /**
   * False when the stored shares file exists but can't be read (another
   * passphrase, a newer version, corrupt). Shares are then unknown, so none
   * are shown and the file must not be overwritten.
   */
  readonly writable: boolean;
  readonly entries: ReadonlyMap<string, ShareEntry>;
}

export const EMPTY_SHARES: ShareIndex = {
  writable: true,
  entries: new Map(),
};

const UNREADABLE_SHARES: ShareIndex = {
  writable: false,
  entries: new Map(),
};

export function newShareId(random: RandomSource = secureRandom): string {
  return toBase64Url(random(16));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function parseLocator(value: unknown): ShareLocator | null {
  if (!isRecord(value)) return null;
  if (value.provider === "github" && isString(value.gistId)) {
    return { provider: "github", gistId: value.gistId };
  }
  if (value.provider === "gitlab" && isString(value.snippetId)) {
    return { provider: "gitlab", snippetId: value.snippetId };
  }
  return null;
}

function parsePath(value: unknown, allowEmpty: boolean): NotePath | null {
  if (!Array.isArray(value)) return null;
  if (!allowEmpty && value.length === 0) return null;
  if (!value.every((s) => isString(s) && s.length > 0)) return null;
  return value as string[];
}

function parseNoteLocation(value: unknown): ShareNoteLocation | null {
  if (!isRecord(value)) return null;
  switch (value.state) {
    case "active": {
      const path = parsePath(value.path, false);
      return path === null ? null : { state: "active", path };
    }
    case "trashed": {
      const path = parsePath(value.path, true);
      if (path === null || !isString(value.entryId)) return null;
      return { state: "trashed", entryId: value.entryId, path };
    }
    case "deleted":
      return { state: "deleted" };
    default:
      return null;
  }
}

function parseSource(value: unknown): ShareSource | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !isString(value.commit) ||
    !isString(value.storedPath) ||
    !isString(value.blobSha)
  ) {
    return undefined;
  }
  return {
    commit: value.commit,
    storedPath: value.storedPath,
    blobSha: value.blobSha,
  };
}

function parseEntry(id: string, value: unknown): ShareEntry | null {
  if (!isRecord(value)) return null;
  const locator = parseLocator(value.locator);
  const note = parseNoteLocation(value.note);
  const source = parseSource(value.source);
  if (
    locator === null ||
    note === null ||
    source === undefined ||
    !isString(value.linkSecret) ||
    !isString(value.name) ||
    !isString(value.sharedAt) ||
    !(value.password === null || isString(value.password))
  ) {
    return null;
  }
  return {
    id,
    locator,
    linkSecret: value.linkSecret,
    password: value.password,
    name: value.name,
    sharedAt: value.sharedAt,
    note,
    source,
    updatedAt: isString(value.updatedAt) ? value.updatedAt : null,
  };
}

/** Entries that aren't well formed are skipped; anything else unexpected makes the whole index unreadable. */
export function parseShareIndex(text: string): ShareIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return UNREADABLE_SHARES;
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== SHARE_FORMAT_VERSION ||
    !isRecord(parsed.shares)
  ) {
    return UNREADABLE_SHARES;
  }
  const entries = new Map<string, ShareEntry>();
  for (const [id, raw] of Object.entries(parsed.shares)) {
    const entry = parseEntry(id, raw);
    if (entry !== null) entries.set(id, entry);
  }
  return { writable: true, entries };
}

function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function locatorJson(locator: ShareLocator): Record<string, unknown> {
  return locator.provider === "github"
    ? { gistId: locator.gistId, provider: locator.provider }
    : { provider: locator.provider, snippetId: locator.snippetId };
}

function noteJson(note: ShareNoteLocation): Record<string, unknown> {
  switch (note.state) {
    case "active":
      return { path: [...note.path], state: note.state };
    case "trashed":
      return {
        entryId: note.entryId,
        path: [...note.path],
        state: note.state,
      };
    case "deleted":
      return { state: note.state };
  }
}

function entryJson(entry: ShareEntry): Record<string, unknown> {
  return {
    linkSecret: entry.linkSecret,
    locator: locatorJson(entry.locator),
    name: entry.name,
    note: noteJson(entry.note),
    password: entry.password,
    sharedAt: entry.sharedAt,
    source:
      entry.source === null
        ? null
        : {
            blobSha: entry.source.blobSha,
            commit: entry.source.commit,
            storedPath: entry.source.storedPath,
          },
    updatedAt: entry.updatedAt,
  };
}

export function serializeShareIndex(index: ShareIndex): string {
  const shares: Record<string, unknown> = {};
  for (const id of [...index.entries.keys()].sort(byCodeUnits)) {
    shares[id] = entryJson(index.entries.get(id)!);
  }
  return JSON.stringify({ shares, version: SHARE_FORMAT_VERSION });
}

export function encryptShareIndex(
  keyring: Keyring,
  index: ShareIndex,
  random?: RandomSource,
): Promise<string> {
  return encryptNote(keyring, serializeShareIndex(index), random);
}

export async function decryptShareIndex(
  keyring: Keyring,
  stored: string,
): Promise<ShareIndex> {
  let text: string;
  try {
    text = await decryptNote(keyring, stored);
  } catch {
    return UNREADABLE_SHARES;
  }
  return parseShareIndex(text);
}

export function findSharesFile(
  listing: readonly TreeEntry[],
): TreeEntry | undefined {
  return listing.find(
    (entry) => entry.type === "blob" && entry.path === SHARES_PATH,
  );
}

export async function readShareIndex(
  listing: readonly TreeEntry[],
  keyring: Keyring,
  readBlob: (sha: string) => Promise<string>,
): Promise<ShareIndex> {
  const entry = findSharesFile(listing);
  if (entry === undefined) return EMPTY_SHARES;
  return decryptShareIndex(keyring, await readBlob(entry.sha));
}

export function isNoteShared(index: ShareIndex, path: NotePath): boolean {
  return sharesOfNote(index, path).length > 0;
}

function newestFirst(a: ShareEntry, b: ShareEntry): number {
  return byCodeUnits(b.sharedAt, a.sharedAt) || byCodeUnits(a.id, b.id);
}

export function sharesOfNote(
  index: ShareIndex,
  path: NotePath,
): readonly ShareEntry[] {
  return [...index.entries.values()]
    .filter(
      (entry) =>
        entry.note.state === "active" && notePathEquals(entry.note.path, path),
    )
    .sort(newestFirst);
}

export type ShareScope =
  | { readonly kind: "within"; readonly path: NotePath }
  | {
      readonly kind: "trashed";
      readonly entryIds: readonly string[] | "all";
    };

export function sharesIn(
  index: ShareIndex,
  scope: ShareScope,
): readonly ShareEntry[] {
  return [...index.entries.values()]
    .filter(({ note }) =>
      scope.kind === "within"
        ? note.state === "active" && isAtOrWithin(note.path, scope.path)
        : note.state === "trashed" &&
          (scope.entryIds === "all" || scope.entryIds.includes(note.entryId)),
    )
    .sort(newestFirst);
}

export function sortedShares(index: ShareIndex): readonly ShareEntry[] {
  return [...index.entries.values()].sort(newestFirst);
}

/**
 * Keeps `index` in step with a structural change, so a share follows its note
 * through renames, moves and the trash, and is marked deleted with it.
 */
export function applyChangeToShares(
  index: ShareIndex,
  change: Change,
): ShareIndex {
  if (!index.writable) return index;
  switch (change.kind) {
    case "add-share": {
      const entries = new Map(index.entries);
      entries.set(change.entry.id, change.entry);
      return { writable: true, entries };
    }
    case "remove-share": {
      if (!index.entries.has(change.id)) return index;
      const entries = new Map(index.entries);
      entries.delete(change.id);
      return { writable: true, entries };
    }
    case "update-share": {
      if (!index.entries.has(change.entry.id)) return index;
      const entries = new Map(index.entries);
      entries.set(change.entry.id, change.entry);
      return { writable: true, entries };
    }
    case "rename-note":
      return mapNotes(index, (note) =>
        note.state === "active" && notePathEquals(note.path, change.from)
          ? { state: "active", path: change.to }
          : note,
      );
    case "rename-folder":
      if (change.from.length === 0 || change.to.length === 0) return index;
      return mapNotes(index, (note) =>
        note.state === "active" && isAtOrWithin(note.path, change.from)
          ? {
              state: "active",
              path: [...change.to, ...note.path.slice(change.from.length)],
            }
          : note,
      );
    case "trash-note":
      return mapNotes(index, (note) =>
        note.state === "active" && notePathEquals(note.path, change.path)
          ? { state: "trashed", entryId: change.entryId, path: [] }
          : note,
      );
    case "trash-folder":
      if (change.path.length === 0) return index;
      return mapNotes(index, (note) =>
        note.state === "active" && isAtOrWithin(note.path, change.path)
          ? {
              state: "trashed",
              entryId: change.entryId,
              path: note.path.slice(change.path.length),
            }
          : note,
      );
    case "restore-trash":
      if (change.to.length === 0) return index;
      return mapNotes(index, (note) =>
        note.state === "trashed" &&
        note.entryId === change.entryId &&
        isAtOrWithin(note.path, change.subPath)
          ? {
              state: "active",
              path: [...change.to, ...note.path.slice(change.subPath.length)],
            }
          : note,
      );
    case "purge-trash":
      return mapNotes(index, (note) =>
        note.state === "trashed" && change.entryIds.includes(note.entryId)
          ? { state: "deleted" }
          : note,
      );
    case "delete-note":
      return mapNotes(index, (note) =>
        note.state === "active" && notePathEquals(note.path, change.path)
          ? { state: "deleted" }
          : note,
      );
    case "delete-folder":
      if (change.path.length === 0) return index;
      return mapNotes(index, (note) =>
        note.state === "active" && isAtOrWithin(note.path, change.path)
          ? { state: "deleted" }
          : note,
      );
    case "create-note":
    case "update-note":
    case "create-folder":
    case "set-order":
    case "set-settings":
    case "set-color-tag":
      return index;
    default: {
      const unreachable: never = change;
      return unreachable;
    }
  }
}

function mapNotes(
  index: ShareIndex,
  transform: (note: ShareNoteLocation) => ShareNoteLocation,
): ShareIndex {
  let changed = false;
  const entries = new Map<string, ShareEntry>();
  for (const [id, entry] of index.entries) {
    const note = transform(entry.note);
    if (note === entry.note) {
      entries.set(id, entry);
    } else {
      changed = true;
      entries.set(id, { ...entry, note });
    }
  }
  return changed ? { writable: true, entries } : index;
}
