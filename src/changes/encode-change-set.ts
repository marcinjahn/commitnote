import type { Keyring } from "../crypto/keyring";
import { encryptPath } from "../crypto/name-cipher";
import { encryptNote } from "../crypto/note-cipher";
import type { RandomSource } from "../crypto/random";
import { serializeRepoConfig, type RepoConfig } from "../crypto/repo-config";
import type { CommitFileChange, TreeEntry } from "../forge/forge-adapter";
import {
  CHANGE_PASSPHRASE_SUBJECT,
  FOLDER_MARKER,
  FORMAT_VERSION,
  INITIALIZE_SUBJECT,
  ORDER_PATH,
  SHARES_PATH,
  TAGS_PATH,
  REPO_CONFIG_PATH,
  SAVE_SUBJECT,
  TRASH_DIR,
  TRAILER,
  UNDO_OUTDATED_SAVE_SUBJECT,
} from "../format/v1";
import { isValidKey } from "../order/fractional-key";
import {
  applyChangeToOrder,
  serializeOrderIndex,
  type OrderIndex,
} from "../order/order-index";
import {
  applyChangeToTags,
  serializeTagIndex,
  type TagIndex,
} from "../tags/tag-index";
import {
  applyChangeToShares,
  serializeShareIndex,
  type ShareIndex,
} from "../share/share-index";
import {
  applySettingsEdits,
  changedSettingKeys,
  type SettingsEdits,
} from "../settings/settings";
import { parseTrashEntryId } from "../trash/trash-entry-id";
import type { Change, ChangeSet, NotePath } from "./change";

export class InvalidChangeSetError extends Error {}

export interface EncodeChangeSetInput {
  readonly listing: readonly TreeEntry[];
  readonly changeSet: ChangeSet;
  /** The order index stored in `listing`. */
  readonly order: OrderIndex;
  /** The tag index stored in `listing`. */
  readonly tags: TagIndex;
  /** The share index stored in `listing`. */
  readonly shares: ShareIndex;
  readonly keyring: Keyring;
  readonly random?: RandomSource;
  /** The parsed config at the head of `listing`; required for `set-settings`. */
  readonly config?: RepoConfig;
}

export interface EncodedChangeSet {
  readonly changes: readonly CommitFileChange[];
  readonly message: string;
}

type WorkingEntry =
  | { readonly kind: "blob"; readonly blobSha: string }
  | { readonly kind: "text"; readonly text: string; readonly encrypt: boolean };

function createStoredPathEncoder(
  keyring: Keyring,
): (path: NotePath) => Promise<string> {
  const cache = new Map<string, Promise<string>>();
  return (path: NotePath): Promise<string> => {
    const key = JSON.stringify(path);
    let cached = cache.get(key);
    if (cached === undefined) {
      cached = encryptPath(keyring, path);
      cache.set(key, cached);
    }
    return cached;
  };
}

function hasEntriesUnder(
  working: ReadonlyMap<string, WorkingEntry>,
  storedPath: string,
): boolean {
  const prefix = `${storedPath}/`;
  for (const key of working.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

function deleteUnder(
  working: Map<string, WorkingEntry>,
  prefix: string,
): void {
  for (const key of [...working.keys()]) {
    if (key.startsWith(prefix)) working.delete(key);
  }
}

function folderExists(
  working: ReadonlyMap<string, WorkingEntry>,
  storedPath: string,
): boolean {
  return storedPath === "" || hasEntriesUnder(working, storedPath);
}

function isFree(
  working: ReadonlyMap<string, WorkingEntry>,
  storedPath: string,
): boolean {
  return !working.has(storedPath) && !hasEntriesUnder(working, storedPath);
}

function canCreateAt(
  working: ReadonlyMap<string, WorkingEntry>,
  stored: string,
  parentStored: string,
): boolean {
  return folderExists(working, parentStored) && isFree(working, stored);
}

function moveEntries(
  working: Map<string, WorkingEntry>,
  from: string,
  to: string,
  isFolder: boolean,
): void {
  const moves: [oldKey: string, newKey: string, value: WorkingEntry][] = [];
  if (isFolder) {
    const prefix = `${from}/`;
    for (const [key, value] of working) {
      if (key.startsWith(prefix)) {
        moves.push([key, `${to}/${key.slice(prefix.length)}`, value]);
      }
    }
  } else {
    const value = working.get(from);
    if (value !== undefined) moves.push([from, to, value]);
  }
  for (const [oldKey] of moves) working.delete(oldKey);
  for (const [, newKey, value] of moves) working.set(newKey, value);
}

function ensureFolderKept(
  working: Map<string, WorkingEntry>,
  storedFolder: string,
): void {
  if (storedFolder === "" || folderExists(working, storedFolder)) return;
  working.set(`${storedFolder}/${FOLDER_MARKER}`, {
    kind: "text",
    text: "",
    encrypt: false,
  });
}

function parentOfStored(storedPath: string): string {
  const slash = storedPath.lastIndexOf("/");
  return slash === -1 ? "" : storedPath.slice(0, slash);
}

function trashEntryRoot(
  working: ReadonlyMap<string, WorkingEntry>,
  entryId: string,
  depth: number,
): string | undefined {
  const prefix = `${TRASH_DIR}/${entryId}/`;
  for (const key of working.keys()) {
    if (!key.startsWith(prefix)) continue;
    const segments = key.slice(prefix.length).split("/");
    if (segments.length < depth) return undefined;
    return segments.slice(0, depth).join("/");
  }
  return undefined;
}

async function applyChange(
  working: Map<string, WorkingEntry>,
  storedPathOf: (path: NotePath) => Promise<string>,
  change: Change,
  index: number,
  trailers: string[],
  orderWritable: boolean,
): Promise<void> {
  function fail(): never {
    throw new InvalidChangeSetError(
      `Change ${index} (${change.kind}) is invalid`,
    );
  }

  switch (change.kind) {
    case "create-folder": {
      const stored = await storedPathOf(change.path);
      const parentStored = await storedPathOf(change.path.slice(0, -1));
      if (!canCreateAt(working, stored, parentStored)) fail();
      working.set(`${stored}/${FOLDER_MARKER}`, {
        kind: "text",
        text: "",
        encrypt: false,
      });
      trailers.push(`${TRAILER.create}: ${stored}`);
      break;
    }
    case "create-note": {
      const stored = await storedPathOf(change.path);
      const parentStored = await storedPathOf(change.path.slice(0, -1));
      if (!canCreateAt(working, stored, parentStored)) fail();
      working.set(stored, {
        kind: "text",
        text: change.content,
        encrypt: true,
      });
      trailers.push(`${TRAILER.create}: ${stored}`);
      break;
    }
    case "update-note": {
      const stored = await storedPathOf(change.path);
      if (!working.has(stored)) fail();
      working.set(stored, {
        kind: "text",
        text: change.content,
        encrypt: true,
      });
      trailers.push(`${TRAILER.update}: ${stored}`);
      break;
    }
    case "delete-note": {
      const stored = await storedPathOf(change.path);
      if (!working.has(stored)) fail();
      working.delete(stored);
      trailers.push(`${TRAILER.delete}: ${stored}`);
      break;
    }
    case "delete-folder": {
      const stored = await storedPathOf(change.path);
      if (!folderExists(working, stored)) fail();
      deleteUnder(working, `${stored}/`);
      trailers.push(`${TRAILER.delete}: ${stored}`);
      break;
    }
    case "rename-note": {
      const fromStored = await storedPathOf(change.from);
      const toStored = await storedPathOf(change.to);
      const toParentStored = await storedPathOf(change.to.slice(0, -1));
      if (
        !working.has(fromStored) ||
        !canCreateAt(working, toStored, toParentStored)
      ) {
        fail();
      }
      moveEntries(working, fromStored, toStored, false);
      trailers.push(`${TRAILER.rename}: ${fromStored} -> ${toStored}`);
      break;
    }
    case "rename-folder": {
      const fromStored = await storedPathOf(change.from);
      const toStored = await storedPathOf(change.to);
      const toParentStored = await storedPathOf(change.to.slice(0, -1));
      const insideFrom =
        toStored === fromStored || toStored.startsWith(`${fromStored}/`);
      if (
        !folderExists(working, fromStored) ||
        !isFree(working, toStored) ||
        insideFrom ||
        !folderExists(working, toParentStored)
      ) {
        fail();
      }
      moveEntries(working, fromStored, toStored, true);
      trailers.push(`${TRAILER.rename}: ${fromStored} -> ${toStored}`);
      break;
    }
    case "trash-note":
    case "trash-folder": {
      const isFolder = change.kind === "trash-folder";
      const parsed = parseTrashEntryId(change.entryId);
      if (parsed === null || parsed.depth !== change.path.length) fail();
      const stored = await storedPathOf(change.path);
      const exists = isFolder
        ? folderExists(working, stored)
        : working.has(stored);
      const trashed = `${TRASH_DIR}/${change.entryId}`;
      if (!exists || stored === "" || !isFree(working, trashed)) fail();
      moveEntries(working, stored, `${trashed}/${stored}`, isFolder);
      ensureFolderKept(working, parentOfStored(stored));
      trailers.push(`${TRAILER.trash}: ${stored} -> ${change.entryId}`);
      break;
    }
    case "restore-trash": {
      const parsed = parseTrashEntryId(change.entryId);
      if (parsed === null || change.to.length === 0) fail();
      const root = trashEntryRoot(working, change.entryId, parsed.depth);
      if (root === undefined) fail();
      const isFolder = change.target === "folder";
      const subStored =
        change.subPath.length === 0 ? "" : await storedPathOf(change.subPath);
      const from = `${TRASH_DIR}/${change.entryId}/${root}${subStored === "" ? "" : `/${subStored}`}`;
      const toStored = await storedPathOf(change.to);
      const toParentStored = await storedPathOf(change.to.slice(0, -1));
      const exists = isFolder
        ? folderExists(working, from)
        : working.has(from);
      if (!exists || !canCreateAt(working, toStored, toParentStored)) fail();
      moveEntries(working, from, toStored, isFolder);
      if (change.subPath.length > 0) {
        ensureFolderKept(working, parentOfStored(from));
      }
      trailers.push(`${TRAILER.restore}: ${change.entryId} -> ${toStored}`);
      break;
    }
    case "purge-trash": {
      for (const entryId of change.entryIds) {
        deleteUnder(working, `${TRASH_DIR}/${entryId}/`);
        trailers.push(`${TRAILER.purge}: ${entryId}`);
      }
      break;
    }
    case "set-order": {
      const parentStored = await storedPathOf(change.parent);
      if (!folderExists(working, parentStored)) fail();
      for (const { name, key } of change.positions) {
        const stored = await storedPathOf([...change.parent, name]);
        if (
          !isValidKey(key) ||
          (!working.has(stored) && !folderExists(working, stored))
        ) {
          fail();
        }
        if (orderWritable) trailers.push(`${TRAILER.order}: ${stored}`);
      }
      break;
    }
    case "set-color-tag": {
      const stored = await storedPathOf(change.path);
      if (!working.has(stored)) fail();
      break;
    }
    case "add-share": {
      if (change.entry.note.state === "active") {
        const stored = await storedPathOf(change.entry.note.path);
        if (!working.has(stored)) fail();
      }
      trailers.push(`${TRAILER.share}: add`);
      break;
    }
    case "update-share": {
      if (change.entry.note.state !== "active") fail();
      const stored = await storedPathOf(change.entry.note.path);
      if (!working.has(stored)) fail();
      trailers.push(`${TRAILER.share}: update`);
      break;
    }
    case "remove-share":
      trailers.push(`${TRAILER.share}: remove`);
      break;
    case "set-share-label":
      trailers.push(`${TRAILER.share}: label`);
      break;
    case "set-settings": {
      const values: unknown = change.values;
      if (
        typeof values !== "object" ||
        values === null ||
        Array.isArray(values) ||
        Object.keys(values).length === 0
      ) {
        fail();
      }
      break;
    }
    default:
      return assertNever(change);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled change kind: ${(value as Change).kind}`);
}

function buildMessage(subject: string, trailers: readonly string[]): string {
  const lines = [`${TRAILER.format}: ${FORMAT_VERSION}`, ...trailers];
  return `${subject}\n\n${lines.join("\n")}`;
}

export function encodeInitializeMessage(): string {
  return buildMessage(INITIALIZE_SUBJECT, []);
}

export function encodeUndoOutdatedSaveMessage(): string {
  return buildMessage(UNDO_OUTDATED_SAVE_SUBJECT, []);
}

export function encodeChangePassphraseMessage(): string {
  return buildMessage(CHANGE_PASSPHRASE_SUBJECT, []);
}

export async function encodeChangeSet(
  input: EncodeChangeSetInput,
): Promise<EncodedChangeSet> {
  const { listing, changeSet, keyring, random, config } = input;
  let order = input.order;
  let tags = input.tags;
  let shares = input.shares;

  if (changeSet.length === 0) {
    throw new InvalidChangeSetError("Change set must not be empty");
  }

  const originalBlobShas = new Map<string, string>();
  const working = new Map<string, WorkingEntry>();
  for (const entry of listing) {
    if (entry.type !== "blob") continue;
    originalBlobShas.set(entry.path, entry.sha);
    working.set(entry.path, { kind: "blob", blobSha: entry.sha });
  }

  const storedPathOf = createStoredPathEncoder(keyring);
  const trailers: string[] = [];
  let settingsEdits: SettingsEdits | undefined;

  for (let index = 0; index < changeSet.length; index++) {
    const change = changeSet[index];
    await applyChange(
      working,
      storedPathOf,
      change,
      index,
      trailers,
      order.writable,
    );
    if (change.kind === "set-settings") {
      if (config === undefined) {
        throw new InvalidChangeSetError(
          `Change ${index} (set-settings) needs the repository config`,
        );
      }
      settingsEdits = { ...settingsEdits, ...change.values };
    }
    order = applyChangeToOrder(order, change);
    tags = applyChangeToTags(tags, change);
    shares = applyChangeToShares(shares, change);
  }

  if (settingsEdits !== undefined && config !== undefined) {
    const keys = changedSettingKeys(config.settings, settingsEdits);
    if (keys.length > 0) {
      working.set(REPO_CONFIG_PATH, {
        kind: "text",
        text: serializeRepoConfig({
          ...config,
          settings: applySettingsEdits(config.settings, settingsEdits),
        }),
        encrypt: false,
      });
      for (const key of keys) trailers.push(`${TRAILER.settings}: ${key}`);
    }
  }

  if (
    order.writable &&
    serializeOrderIndex(order) !== serializeOrderIndex(input.order)
  ) {
    working.set(ORDER_PATH, {
      kind: "text",
      text: serializeOrderIndex(order),
      encrypt: true,
    });
  }

  if (tags.writable && serializeTagIndex(tags) !== serializeTagIndex(input.tags)) {
    working.set(TAGS_PATH, {
      kind: "text",
      text: serializeTagIndex(tags),
      encrypt: true,
    });
  }

  if (
    shares.writable &&
    serializeShareIndex(shares) !== serializeShareIndex(input.shares)
  ) {
    working.set(SHARES_PATH, {
      kind: "text",
      text: serializeShareIndex(shares),
      encrypt: true,
    });
  }

  const commitChanges: CommitFileChange[] = [];

  for (const path of originalBlobShas.keys()) {
    if (!working.has(path)) {
      commitChanges.push({ kind: "delete", path });
    }
  }

  for (const [path, entry] of working) {
    if (entry.kind === "blob") {
      if (originalBlobShas.get(path) === entry.blobSha) continue;
      commitChanges.push({ kind: "upsert-blob", path, blobSha: entry.blobSha });
    } else {
      const text = entry.encrypt
        ? await encryptNote(keyring, entry.text, random)
        : entry.text;
      commitChanges.push({ kind: "upsert-text", path, text });
    }
  }

  commitChanges.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );

  return {
    changes: commitChanges,
    message: buildMessage(SAVE_SUBJECT, trailers),
  };
}
