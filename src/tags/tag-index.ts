import type { Change, NotePath } from "../changes/change";
import { isAtOrWithin } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { decryptNote, encryptNote } from "../crypto/note-cipher";
import type { RandomSource } from "../crypto/random";
import type { TreeEntry } from "../forge/forge-adapter";
import { TAGS_PATH } from "../format/v1";
import { parseColorTag, type ColorTag } from "./color-tag";

const TAG_FORMAT_VERSION = 1;

export interface TagRecord {
  readonly color: ColorTag;
}

export type TrashedTags = ReadonlyMap<string, TagRecord>;

export interface TagIndex {
  /**
   * False when the stored tags file exists but can't be read (another
   * passphrase, a newer version, corrupt). Tags are then unknown, so none are
   * shown and the file must not be overwritten.
   */
  readonly writable: boolean;
  /** By note path, encoded with `tagKey`. */
  readonly notes: ReadonlyMap<string, TagRecord>;
  /**
   * By trash entry id, then by `tagKey` of the note's path relative to the
   * trashed item (`[]` for a trashed note itself).
   */
  readonly trash: ReadonlyMap<string, TrashedTags>;
}

export const EMPTY_TAGS: TagIndex = {
  writable: true,
  notes: new Map(),
  trash: new Map(),
};

const UNREADABLE_TAGS: TagIndex = {
  writable: false,
  notes: new Map(),
  trash: new Map(),
};

export function tagKey(path: NotePath): string {
  return JSON.stringify(path);
}

function parseTagKey(key: string): NotePath | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (!parsed.every((s) => typeof s === "string" && s.length > 0)) return null;
  return parsed as string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTagRecord(value: unknown): TagRecord | null {
  if (!isRecord(value)) return null;
  const color = parseColorTag(value.color);
  return color === null ? null : { color };
}

function parseTagMap(
  raw: Record<string, unknown>,
  allowRoot: boolean,
): Map<string, TagRecord> {
  const map = new Map<string, TagRecord>();
  for (const [key, value] of Object.entries(raw)) {
    const path = parseTagKey(key);
    if (path === null || (!allowRoot && path.length === 0)) continue;
    const record = parseTagRecord(value);
    if (record !== null) map.set(tagKey(path), record);
  }
  return map;
}

/** Records that aren't well formed are skipped; anything else unexpected makes the whole index unreadable. */
export function parseTagIndex(text: string): TagIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return UNREADABLE_TAGS;
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== TAG_FORMAT_VERSION ||
    !isRecord(parsed.notes) ||
    (parsed.trash !== undefined && !isRecord(parsed.trash))
  ) {
    return UNREADABLE_TAGS;
  }
  const notes = parseTagMap(parsed.notes, false);
  const trash = new Map<string, TrashedTags>();
  for (const [entryId, records] of Object.entries(parsed.trash ?? {})) {
    if (!isRecord(records)) continue;
    const entry = parseTagMap(records, true);
    if (entry.size > 0) trash.set(entryId, entry);
  }
  return { writable: true, notes, trash };
}

function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedRecords(
  map: ReadonlyMap<string, TagRecord>,
): Record<string, TagRecord> {
  const sorted: Record<string, TagRecord> = {};
  for (const key of [...map.keys()].sort(byCodeUnits)) {
    sorted[key] = { color: map.get(key)!.color };
  }
  return sorted;
}

export function serializeTagIndex(index: TagIndex): string {
  const trash: Record<string, Record<string, TagRecord>> = {};
  for (const id of [...index.trash.keys()].sort(byCodeUnits)) {
    const entry = index.trash.get(id)!;
    if (entry.size > 0) trash[id] = sortedRecords(entry);
  }
  return JSON.stringify({
    version: TAG_FORMAT_VERSION,
    notes: sortedRecords(index.notes),
    trash,
  });
}

export function encryptTagIndex(
  keyring: Keyring,
  index: TagIndex,
  random?: RandomSource,
): Promise<string> {
  return encryptNote(keyring, serializeTagIndex(index), random);
}

export async function decryptTagIndex(
  keyring: Keyring,
  stored: string,
): Promise<TagIndex> {
  let text: string;
  try {
    text = await decryptNote(keyring, stored);
  } catch {
    return UNREADABLE_TAGS;
  }
  return parseTagIndex(text);
}

export function findTagEntry(
  listing: readonly TreeEntry[],
): TreeEntry | undefined {
  return listing.find(
    (entry) => entry.type === "blob" && entry.path === TAGS_PATH,
  );
}

export async function readTagIndex(
  listing: readonly TreeEntry[],
  keyring: Keyring,
  readBlob: (sha: string) => Promise<string>,
): Promise<TagIndex> {
  const entry = findTagEntry(listing);
  if (entry === undefined) return EMPTY_TAGS;
  return decryptTagIndex(keyring, await readBlob(entry.sha));
}

export function colorTagOf(index: TagIndex, path: NotePath): ColorTag | null {
  return index.notes.get(tagKey(path))?.color ?? null;
}

/** `subPath` is relative to the trash entry's trashed item; `[]` is the item itself. */
export function trashedColorTagOf(
  index: TagIndex,
  entryId: string,
  subPath: NotePath,
): ColorTag | null {
  return index.trash.get(entryId)?.get(tagKey(subPath))?.color ?? null;
}

class TagEditor {
  private readonly notes: Map<string, TagRecord>;
  private readonly trash: Map<string, Map<string, TagRecord>>;

  constructor(index: TagIndex) {
    this.notes = new Map(index.notes);
    this.trash = new Map(
      [...index.trash].map(([id, entry]) => [id, new Map(entry)]),
    );
  }

  set(path: NotePath, record: TagRecord): void {
    this.notes.set(tagKey(path), record);
  }

  take(path: NotePath): TagRecord | undefined {
    const key = tagKey(path);
    const record = this.notes.get(key);
    this.notes.delete(key);
    return record;
  }

  takeWithin(folder: NotePath): [NotePath, TagRecord][] {
    const taken: [NotePath, TagRecord][] = [];
    for (const [key, record] of [...this.notes]) {
      const path = parseTagKey(key)!;
      if (!isAtOrWithin(path, folder)) continue;
      this.notes.delete(key);
      taken.push([path, record]);
    }
    return taken;
  }

  stash(entryId: string, relative: NotePath, record: TagRecord): void {
    let entry = this.trash.get(entryId);
    if (entry === undefined) {
      entry = new Map();
      this.trash.set(entryId, entry);
    }
    entry.set(tagKey(relative), record);
  }

  unstash(
    entryId: string,
    subPath: NotePath,
  ): [NotePath, TagRecord][] {
    const entry = this.trash.get(entryId);
    if (entry === undefined) return [];
    const taken: [NotePath, TagRecord][] = [];
    for (const [key, record] of [...entry]) {
      const relative = parseTagKey(key) ?? [];
      if (!isAtOrWithin(relative, subPath)) continue;
      entry.delete(key);
      taken.push([relative, record]);
    }
    if (entry.size === 0) this.trash.delete(entryId);
    return taken;
  }

  purge(entryId: string): void {
    this.trash.delete(entryId);
  }

  result(): TagIndex {
    return { writable: true, notes: this.notes, trash: this.trash };
  }
}

/**
 * Keeps `index` in step with a structural change, so a note's tag follows it
 * through renames, moves and the trash, and disappears with the note.
 */
export function applyChangeToTags(index: TagIndex, change: Change): TagIndex {
  if (!index.writable) return index;
  const editor = new TagEditor(index);
  switch (change.kind) {
    case "set-color-tag":
      if (change.color === null) editor.take(change.path);
      else editor.set(change.path, { color: change.color });
      break;
    case "create-note":
    case "delete-note":
      editor.take(change.path);
      break;
    case "delete-folder":
      if (change.path.length === 0) return index;
      editor.takeWithin(change.path);
      break;
    case "rename-note": {
      editor.take(change.to);
      const record = editor.take(change.from);
      if (record !== undefined) editor.set(change.to, record);
      break;
    }
    case "rename-folder": {
      if (change.from.length === 0 || change.to.length === 0) return index;
      editor.takeWithin(change.to);
      for (const [path, record] of editor.takeWithin(change.from)) {
        editor.set([...change.to, ...path.slice(change.from.length)], record);
      }
      break;
    }
    case "trash-note": {
      const record = editor.take(change.path);
      if (record !== undefined) editor.stash(change.entryId, [], record);
      break;
    }
    case "trash-folder":
      if (change.path.length === 0) return index;
      for (const [path, record] of editor.takeWithin(change.path)) {
        editor.stash(change.entryId, path.slice(change.path.length), record);
      }
      break;
    case "restore-trash": {
      if (change.to.length === 0) return index;
      editor.takeWithin(change.to);
      for (const [relative, record] of editor.unstash(
        change.entryId,
        change.subPath,
      )) {
        editor.set(
          [...change.to, ...relative.slice(change.subPath.length)],
          record,
        );
      }
      break;
    }
    case "purge-trash":
      for (const id of change.entryIds) editor.purge(id);
      break;
    case "update-note":
    case "create-folder":
    case "set-order":
    case "set-settings":
    case "add-share":
    case "update-share":
    case "remove-share":
      return index;
    default: {
      const unreachable: never = change;
      return unreachable;
    }
  }
  return editor.result();
}
