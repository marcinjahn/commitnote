import type { Change, NotePath } from "../changes/change";
import {
  isAtOrWithin,
  isWithinFolder,
  notePathEquals,
} from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { decryptNote, encryptNote } from "../crypto/note-cipher";
import type { RandomSource } from "../crypto/random";
import type { TreeEntry } from "../forge/forge-adapter";
import { IMAGE_INDEX_PATH, TRASH_RETENTION_MS } from "../format/v1";
import { type ImageId, imageIdOfPath, isImageId } from "./image-id";

export const IMAGE_INDEX_FORMAT_VERSION = 1;

export type ImageOwner =
  | { readonly state: "active"; readonly path: NotePath }
  | {
      readonly state: "trashed";
      readonly entryId: string;
      /** Relative to the trashed item; `[]` for a trashed note. */
      readonly path: NotePath;
    };

export interface ImageRecord {
  readonly blobSha: string;
  readonly owners: readonly ImageOwner[];
}

export interface ImageTombstone {
  readonly blobSha: string;
  readonly removedAt: number;
}

export interface ImageIndex {
  /**
   * False when the stored index exists but can't be read. Image ownership is
   * then unknown, so the index must not be overwritten and no image files may
   * be written or deleted on its behalf.
   */
  readonly writable: boolean;
  readonly images: ReadonlyMap<ImageId, ImageRecord>;
  readonly tombstones: ReadonlyMap<ImageId, ImageTombstone>;
}

export type AvailableImage =
  | {
      readonly kind: "envelope";
      readonly envelope: Uint8Array;
      readonly blobSha: string;
    }
  | { readonly kind: "sha"; readonly blobSha: string };

export type ImageFileChange =
  | {
      readonly kind: "write";
      readonly imageId: ImageId;
      readonly envelope: Uint8Array;
    }
  | {
      readonly kind: "revive";
      readonly imageId: ImageId;
      readonly blobSha: string;
    }
  | { readonly kind: "delete"; readonly imageId: ImageId };

export interface ImageIndexUpdate {
  readonly index: ImageIndex;
  readonly fileChanges: readonly ImageFileChange[];
  /** Ids whose `available` entry was used. */
  readonly consumed: readonly ImageId[];
}

export const EMPTY_IMAGES: ImageIndex = {
  writable: true,
  images: new Map(),
  tombstones: new Map(),
};

const UNREADABLE_IMAGES: ImageIndex = {
  writable: false,
  images: new Map(),
  tombstones: new Map(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function parsePath(value: unknown, allowEmpty: boolean): NotePath | null {
  if (!Array.isArray(value)) return null;
  if (!allowEmpty && value.length === 0) return null;
  if (!value.every((s) => isString(s) && s.length > 0)) return null;
  return value as string[];
}

function parseOwner(value: unknown): ImageOwner | null {
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
    default:
      return null;
  }
}

function parseRecord(value: unknown): ImageRecord | null {
  if (
    !isRecord(value) ||
    !isString(value.blobSha) ||
    !Array.isArray(value.owners) ||
    value.owners.length === 0
  ) {
    return null;
  }
  const owners: ImageOwner[] = [];
  for (const raw of value.owners) {
    const owner = parseOwner(raw);
    if (owner === null) return null;
    owners.push(owner);
  }
  return { blobSha: value.blobSha, owners: uniqueOwners(owners) };
}

function parseTombstone(value: unknown): ImageTombstone | null {
  if (
    !isRecord(value) ||
    !isString(value.blobSha) ||
    typeof value.removedAt !== "number" ||
    !Number.isFinite(value.removedAt)
  ) {
    return null;
  }
  return { blobSha: value.blobSha, removedAt: value.removedAt };
}

/** Records that aren't well formed are skipped; anything else unexpected makes the whole index unreadable. */
export function parseImageIndex(text: string): ImageIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return UNREADABLE_IMAGES;
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== IMAGE_INDEX_FORMAT_VERSION ||
    !isRecord(parsed.images) ||
    !isRecord(parsed.tombstones)
  ) {
    return UNREADABLE_IMAGES;
  }
  const images = new Map<ImageId, ImageRecord>();
  for (const [id, raw] of Object.entries(parsed.images)) {
    if (!isImageId(id)) continue;
    const record = parseRecord(raw);
    if (record !== null) images.set(id, record);
  }
  const tombstones = new Map<ImageId, ImageTombstone>();
  for (const [id, raw] of Object.entries(parsed.tombstones)) {
    if (!isImageId(id)) continue;
    const tombstone = parseTombstone(raw);
    if (tombstone !== null) tombstones.set(id, tombstone);
  }
  return { writable: true, images, tombstones };
}

function ownerJson(owner: ImageOwner): Record<string, unknown> {
  return owner.state === "active"
    ? { path: [...owner.path], state: owner.state }
    : { entryId: owner.entryId, path: [...owner.path], state: owner.state };
}

function ownerKey(owner: ImageOwner): string {
  return JSON.stringify(ownerJson(owner));
}

function uniqueOwners(owners: readonly ImageOwner[]): ImageOwner[] {
  const byKey = new Map<string, ImageOwner>();
  for (const owner of owners) byKey.set(ownerKey(owner), owner);
  return [...byKey.keys()].sort(byCodeUnits).map((key) => byKey.get(key)!);
}

export function serializeImageIndex(index: ImageIndex): string {
  const images: Record<string, unknown> = {};
  for (const id of [...index.images.keys()].sort(byCodeUnits)) {
    const record = index.images.get(id)!;
    images[id] = {
      blobSha: record.blobSha,
      owners: uniqueOwners(record.owners).map(ownerJson),
    };
  }
  const tombstones: Record<string, unknown> = {};
  for (const id of [...index.tombstones.keys()].sort(byCodeUnits)) {
    const tombstone = index.tombstones.get(id)!;
    tombstones[id] = {
      blobSha: tombstone.blobSha,
      removedAt: tombstone.removedAt,
    };
  }
  return JSON.stringify({
    images,
    tombstones,
    version: IMAGE_INDEX_FORMAT_VERSION,
  });
}

export function encryptImageIndex(
  keyring: Keyring,
  index: ImageIndex,
  random?: RandomSource,
): Promise<string> {
  return encryptNote(keyring, serializeImageIndex(index), random);
}

export async function decryptImageIndex(
  keyring: Keyring,
  stored: string,
): Promise<ImageIndex> {
  let text: string;
  try {
    text = await decryptNote(keyring, stored);
  } catch {
    return UNREADABLE_IMAGES;
  }
  return parseImageIndex(text);
}

export function findImageIndexEntry(
  listing: readonly TreeEntry[],
): TreeEntry | undefined {
  return listing.find(
    (entry) => entry.type === "blob" && entry.path === IMAGE_INDEX_PATH,
  );
}

export async function readImageIndex(
  listing: readonly TreeEntry[],
  keyring: Keyring,
  readBlob: (sha: string) => Promise<string>,
): Promise<ImageIndex> {
  const entry = findImageIndexEntry(listing);
  if (entry === undefined) return EMPTY_IMAGES;
  return decryptImageIndex(keyring, await readBlob(entry.sha));
}

function unchanged(index: ImageIndex): ImageIndexUpdate {
  return { index, fileChanges: [], consumed: [] };
}

function ownsActive(record: ImageRecord, path: NotePath): boolean {
  return record.owners.some(
    (owner) => owner.state === "active" && notePathEquals(owner.path, path),
  );
}

export function reconcileNoteImages(
  index: ImageIndex,
  notePath: NotePath,
  referencedIds: ReadonlySet<ImageId>,
  available: ReadonlyMap<ImageId, AvailableImage>,
  now: number,
): ImageIndexUpdate {
  if (!index.writable) return unchanged(index);
  const note: ImageOwner = { state: "active", path: notePath };
  let images: Map<ImageId, ImageRecord> | null = null;
  let tombstones: Map<ImageId, ImageTombstone> | null = null;
  const writableImages = () => (images ??= new Map(index.images));
  const writableTombstones = () => (tombstones ??= new Map(index.tombstones));
  const fileChanges: ImageFileChange[] = [];
  const consumed: ImageId[] = [];

  for (const id of [...referencedIds].sort(byCodeUnits)) {
    const record = index.images.get(id);
    if (record !== undefined) {
      if (!ownsActive(record, notePath)) {
        writableImages().set(id, {
          blobSha: record.blobSha,
          owners: uniqueOwners([...record.owners, note]),
        });
      }
      continue;
    }
    const tombstone = index.tombstones.get(id);
    const candidate = available.get(id);
    if (tombstone !== undefined) {
      writableImages().set(id, { blobSha: tombstone.blobSha, owners: [note] });
      writableTombstones().delete(id);
      fileChanges.push({
        kind: "revive",
        imageId: id,
        blobSha: tombstone.blobSha,
      });
      if (candidate !== undefined) consumed.push(id);
      continue;
    }
    if (candidate === undefined) continue;
    writableImages().set(id, { blobSha: candidate.blobSha, owners: [note] });
    fileChanges.push(
      candidate.kind === "envelope"
        ? { kind: "write", imageId: id, envelope: candidate.envelope }
        : { kind: "revive", imageId: id, blobSha: candidate.blobSha },
    );
    consumed.push(id);
  }

  for (const id of [...index.images.keys()].sort(byCodeUnits)) {
    if (referencedIds.has(id)) continue;
    const record = index.images.get(id)!;
    if (!ownsActive(record, notePath)) continue;
    const owners = record.owners.filter(
      (owner) =>
        !(owner.state === "active" && notePathEquals(owner.path, notePath)),
    );
    if (owners.length > 0) {
      writableImages().set(id, { blobSha: record.blobSha, owners });
    } else {
      writableImages().delete(id);
      writableTombstones().set(id, { blobSha: record.blobSha, removedAt: now });
      fileChanges.push({ kind: "delete", imageId: id });
    }
  }

  if (images === null && tombstones === null) return unchanged(index);
  return {
    index: {
      writable: true,
      images: images ?? index.images,
      tombstones: tombstones ?? index.tombstones,
    },
    fileChanges,
    consumed,
  };
}

/**
 * Keeps `index` in step with a structural change, so an image follows its
 * owners through renames, moves and the trash, and is removed with its last
 * owner.
 */
export function applyChangeToImages(
  index: ImageIndex,
  change: Change,
  now: number,
): ImageIndexUpdate {
  if (!index.writable) return unchanged(index);
  switch (change.kind) {
    case "rename-note":
      return mapOwners(index, now, (owner) =>
        owner.state === "active" && notePathEquals(owner.path, change.from)
          ? { state: "active", path: change.to }
          : owner,
      );
    case "rename-folder":
      if (change.from.length === 0 || change.to.length === 0) {
        return unchanged(index);
      }
      return mapOwners(index, now, (owner) =>
        owner.state === "active" && isAtOrWithin(owner.path, change.from)
          ? {
              state: "active",
              path: [...change.to, ...owner.path.slice(change.from.length)],
            }
          : owner,
      );
    case "trash-note":
      return mapOwners(index, now, (owner) =>
        owner.state === "active" && notePathEquals(owner.path, change.path)
          ? { state: "trashed", entryId: change.entryId, path: [] }
          : owner,
      );
    case "trash-folder":
      if (change.path.length === 0) return unchanged(index);
      return mapOwners(index, now, (owner) =>
        owner.state === "active" && isWithinFolder(owner.path, change.path)
          ? {
              state: "trashed",
              entryId: change.entryId,
              path: owner.path.slice(change.path.length),
            }
          : owner,
      );
    case "restore-trash":
      if (change.to.length === 0) return unchanged(index);
      return mapOwners(index, now, (owner) =>
        owner.state === "trashed" &&
        owner.entryId === change.entryId &&
        isAtOrWithin(owner.path, change.subPath)
          ? {
              state: "active",
              path: [...change.to, ...owner.path.slice(change.subPath.length)],
            }
          : owner,
      );
    case "delete-note":
      return mapOwners(index, now, (owner) =>
        owner.state === "active" && notePathEquals(owner.path, change.path)
          ? null
          : owner,
      );
    case "delete-folder":
      if (change.path.length === 0) return unchanged(index);
      return mapOwners(index, now, (owner) =>
        owner.state === "active" && isAtOrWithin(owner.path, change.path)
          ? null
          : owner,
      );
    case "purge-trash":
      return mapOwners(index, now, (owner) =>
        owner.state === "trashed" && change.entryIds.includes(owner.entryId)
          ? null
          : owner,
      );
    case "create-note":
    case "update-note":
    case "create-folder":
    case "set-order":
    case "set-settings":
    case "set-color-tag":
    case "add-share":
    case "update-share":
    case "remove-share":
    case "set-share-label":
      return unchanged(index);
    default: {
      const unreachable: never = change;
      return unreachable;
    }
  }
}

/** `transform` returns the owner itself when it is untouched, or null to remove it. */
function mapOwners(
  index: ImageIndex,
  now: number,
  transform: (owner: ImageOwner) => ImageOwner | null,
): ImageIndexUpdate {
  let changed = false;
  const images = new Map<ImageId, ImageRecord>();
  let tombstones: Map<ImageId, ImageTombstone> | null = null;
  const fileChanges: ImageFileChange[] = [];
  for (const id of [...index.images.keys()].sort(byCodeUnits)) {
    const record = index.images.get(id)!;
    const owners: ImageOwner[] = [];
    let recordChanged = false;
    for (const owner of record.owners) {
      const next = transform(owner);
      if (next !== owner) recordChanged = true;
      if (next !== null) owners.push(next);
    }
    if (!recordChanged) {
      images.set(id, record);
      continue;
    }
    changed = true;
    if (owners.length > 0) {
      images.set(id, { blobSha: record.blobSha, owners: uniqueOwners(owners) });
    } else {
      tombstones ??= new Map(index.tombstones);
      tombstones.set(id, { blobSha: record.blobSha, removedAt: now });
      fileChanges.push({ kind: "delete", imageId: id });
    }
  }
  if (!changed) return unchanged(index);
  return {
    index: {
      writable: true,
      images,
      tombstones: tombstones ?? index.tombstones,
    },
    fileChanges,
    consumed: [],
  };
}

export function pruneExpiredTombstones(
  index: ImageIndex,
  now: number,
): ImageIndex {
  if (!index.writable) return index;
  let tombstones: Map<ImageId, ImageTombstone> | null = null;
  for (const [id, tombstone] of index.tombstones) {
    if (tombstone.removedAt + TRASH_RETENTION_MS <= now) {
      tombstones ??= new Map(index.tombstones);
      tombstones.delete(id);
    }
  }
  return tombstones === null
    ? index
    : { writable: true, images: index.images, tombstones };
}

/** `imageFilePaths` are the blob paths currently under the images directory. */
export function planImageSweep(
  index: ImageIndex,
  imageFilePaths: readonly string[],
  now: number,
  maxFiles: number,
): { index: ImageIndex; deletes: readonly string[] } {
  if (!index.writable) return { index, deletes: [] };
  const orphans = imageFilePaths.filter((path) => {
    const id = imageIdOfPath(path);
    return id === null || (!index.images.has(id) && !index.tombstones.has(id));
  });
  return {
    index: pruneExpiredTombstones(index, now),
    deletes: [...new Set(orphans)]
      .sort(byCodeUnits)
      .slice(0, Math.max(0, maxFiles)),
  };
}
