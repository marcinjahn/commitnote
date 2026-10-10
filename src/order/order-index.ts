import type { Change, NotePath, OrderPosition } from "../changes/change";
import { isAtOrWithin, notePathEquals, parentPath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { decryptNote, encryptNote } from "../crypto/note-cipher";
import type { RandomSource } from "../crypto/random";
import type { TreeEntry } from "../forge/forge-adapter";
import { ORDER_PATH } from "../format/v1";
import { compareNames } from "../tree/note-names";
import { compareKeys, isValidKey } from "./fractional-key";

const ORDER_FORMAT_VERSION = 1;

/** Child name to order key, for the children of one folder. */
export type FolderOrder = ReadonlyMap<string, string>;

export interface OrderIndex {
  /**
   * False when the stored order file exists but can't be read (another
   * passphrase, a newer version, corrupt). Its positions are then unknown, so
   * the tree falls back to name order and the file must not be overwritten.
   */
  readonly writable: boolean;
  /** By folder path, encoded with `folderKey`. */
  readonly folders: ReadonlyMap<string, FolderOrder>;
}

export const EMPTY_ORDER: OrderIndex = { writable: true, folders: new Map() };

const UNREADABLE_ORDER: OrderIndex = { writable: false, folders: new Map() };

export function folderKey(path: NotePath): string {
  return JSON.stringify(path);
}

function parseFolderKey(key: string): NotePath | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (!parsed.every((segment) => typeof segment === "string")) return null;
  return parsed as string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Entries that aren't well formed are skipped; anything else unexpected makes the whole index unreadable. */
export function parseOrderIndex(text: string): OrderIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return UNREADABLE_ORDER;
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== ORDER_FORMAT_VERSION ||
    !isRecord(parsed.folders)
  ) {
    return UNREADABLE_ORDER;
  }
  const folders = new Map<string, FolderOrder>();
  for (const [key, children] of Object.entries(parsed.folders)) {
    const path = parseFolderKey(key);
    if (path === null || !isRecord(children)) continue;
    const order = new Map<string, string>();
    for (const [name, orderKey] of Object.entries(children)) {
      if (typeof orderKey === "string" && isValidKey(orderKey)) {
        order.set(name, orderKey);
      }
    }
    if (order.size > 0) folders.set(folderKey(path), order);
  }
  return { writable: true, folders };
}

function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function serializeOrderIndex(index: OrderIndex): string {
  const folders: Record<string, Record<string, string>> = {};
  for (const key of [...index.folders.keys()].sort(byCodeUnits)) {
    const order = index.folders.get(key)!;
    if (order.size === 0) continue;
    const children: Record<string, string> = {};
    for (const name of [...order.keys()].sort(byCodeUnits)) {
      children[name] = order.get(name)!;
    }
    folders[key] = children;
  }
  return JSON.stringify({ version: ORDER_FORMAT_VERSION, folders });
}

export function encryptOrderIndex(
  keyring: Keyring,
  index: OrderIndex,
  random?: RandomSource,
): Promise<string> {
  return encryptNote(keyring, serializeOrderIndex(index), random);
}

export async function decryptOrderIndex(
  keyring: Keyring,
  stored: string,
): Promise<OrderIndex> {
  let text: string;
  try {
    text = await decryptNote(keyring, stored);
  } catch {
    return UNREADABLE_ORDER;
  }
  return parseOrderIndex(text);
}

export function findOrderEntry(
  listing: readonly TreeEntry[],
): TreeEntry | undefined {
  return listing.find(
    (entry) => entry.type === "blob" && entry.path === ORDER_PATH,
  );
}

export async function readOrderIndex(
  listing: readonly TreeEntry[],
  keyring: Keyring,
  readBlob: (sha: string) => Promise<string>,
): Promise<OrderIndex> {
  const entry = findOrderEntry(listing);
  if (entry === undefined) return EMPTY_ORDER;
  return decryptOrderIndex(keyring, await readBlob(entry.sha));
}

interface Sibling {
  readonly kind: "note" | "folder";
  readonly name: string;
}

/**
 * Orders the children of `parent`: positioned ones by key, then the rest
 * folders first and by name.
 */
export function siblingComparator(
  index: OrderIndex,
  parent: NotePath,
): (a: Sibling, b: Sibling) => number {
  const order = index.folders.get(folderKey(parent));
  return (a, b) => {
    const keyA = order?.get(a.name);
    const keyB = order?.get(b.name);
    if (keyA !== undefined && keyB !== undefined) {
      return compareKeys(keyA, keyB) || compareNames(a.name, b.name);
    }
    if (keyA !== undefined) return -1;
    if (keyB !== undefined) return 1;
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return compareNames(a.name, b.name);
  };
}

export function withKeys(
  index: OrderIndex,
  parent: NotePath,
  positions: readonly OrderPosition[],
): OrderIndex {
  if (!index.writable || positions.length === 0) return index;
  const folders = new Map(index.folders);
  const order = new Map(folders.get(folderKey(parent)));
  for (const { name, key } of positions) order.set(name, key);
  folders.set(folderKey(parent), order);
  return { writable: true, folders };
}

class OrderEditor {
  private readonly folders: Map<string, FolderOrder>;

  constructor(index: OrderIndex) {
    this.folders = new Map(index.folders);
  }

  take(path: NotePath): string | undefined {
    const parent = folderKey(parentPath(path));
    const order = this.folders.get(parent);
    const name = path[path.length - 1];
    const key = order?.get(name);
    if (order === undefined || key === undefined) return undefined;
    const rest = new Map(order);
    rest.delete(name);
    if (rest.size === 0) this.folders.delete(parent);
    else this.folders.set(parent, rest);
    return key;
  }

  put(path: NotePath, key: string): void {
    const parent = folderKey(parentPath(path));
    const order = new Map(this.folders.get(parent));
    order.set(path[path.length - 1], key);
    this.folders.set(parent, order);
  }

  dropFolder(folder: NotePath): void {
    for (const key of [...this.folders.keys()]) {
      const path = parseFolderKey(key)!;
      if (isAtOrWithin(path, folder)) {
        this.folders.delete(key);
      }
    }
  }

  rebaseFolder(from: NotePath, to: NotePath): void {
    const moved: [string, FolderOrder][] = [];
    for (const [key, order] of [...this.folders]) {
      const path = parseFolderKey(key)!;
      if (!isAtOrWithin(path, from)) continue;
      this.folders.delete(key);
      moved.push([folderKey([...to, ...path.slice(from.length)]), order]);
    }
    for (const [key, order] of moved) this.folders.set(key, order);
  }

  result(): OrderIndex {
    return { writable: true, folders: this.folders };
  }
}

/**
 * Keeps `index` in step with a structural change: a rename within a folder
 * keeps the item's position, an item moved to another folder or newly
 * created there has none, and a removed item takes its folder's positions
 * with it.
 */
export function applyChangeToOrder(
  index: OrderIndex,
  change: Change,
): OrderIndex {
  if (!index.writable) return index;
  const editor = new OrderEditor(index);
  switch (change.kind) {
    case "create-note":
    case "create-folder":
      editor.take(change.path);
      editor.dropFolder(change.path);
      break;
    case "delete-note":
    case "trash-note":
      if (change.path.length === 0) return index;
      editor.take(change.path);
      break;
    case "delete-folder":
    case "trash-folder":
      if (change.path.length === 0) return index;
      editor.take(change.path);
      editor.dropFolder(change.path);
      break;
    case "rename-note":
    case "rename-folder": {
      if (change.from.length === 0 || change.to.length === 0) return index;
      const key = editor.take(change.from);
      editor.take(change.to);
      if (change.kind === "rename-folder") {
        editor.dropFolder(change.to);
        editor.rebaseFolder(change.from, change.to);
      }
      if (
        key !== undefined &&
        notePathEquals(parentPath(change.from), parentPath(change.to))
      ) {
        editor.put(change.to, key);
      }
      break;
    }
    case "restore-trash":
      if (change.to.length === 0) return index;
      editor.take(change.to);
      editor.dropFolder(change.to);
      break;
    case "set-order":
      return withKeys(index, change.parent, change.positions);
    case "update-note":
    case "purge-trash":
    case "set-settings":
    case "set-color-tag":
    case "add-share":
    case "update-share":
    case "remove-share":
    case "set-share-label":
      return index;
    default:
      return assertNever(change);
  }
  return editor.result();
}

function assertNever(value: never): never {
  throw new Error(`Unhandled change kind: ${(value as Change).kind}`);
}
