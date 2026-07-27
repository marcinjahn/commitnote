import type { Keyring } from "../crypto/keyring";
import { encryptPath } from "../crypto/name-cipher";
import { encryptNote } from "../crypto/note-cipher";
import type { RandomSource } from "../crypto/random";
import type { CommitFileChange, TreeEntry } from "../forge/forge-adapter";
import {
  FOLDER_MARKER,
  FORMAT_VERSION,
  INITIALIZE_SUBJECT,
  SAVE_SUBJECT,
  TRAILER,
} from "../format/v1";
import type { Change, ChangeSet, NotePath } from "./change";

export class InvalidChangeSetError extends Error {}

export interface EncodeChangeSetInput {
  readonly listing: readonly TreeEntry[];
  readonly changeSet: ChangeSet;
  readonly keyring: Keyring;
  readonly random?: RandomSource;
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

function folderExists(
  working: ReadonlyMap<string, WorkingEntry>,
  storedPath: string,
): boolean {
  if (storedPath === "") return true;
  const prefix = `${storedPath}/`;
  for (const key of working.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

function isFree(
  working: ReadonlyMap<string, WorkingEntry>,
  storedPath: string,
): boolean {
  if (working.has(storedPath)) return false;
  const prefix = `${storedPath}/`;
  for (const key of working.keys()) {
    if (key.startsWith(prefix)) return false;
  }
  return true;
}

async function applyChange(
  working: Map<string, WorkingEntry>,
  storedPathOf: (path: NotePath) => Promise<string>,
  change: Change,
  index: number,
  trailers: string[],
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
      if (!folderExists(working, parentStored) || !isFree(working, stored)) {
        fail();
      }
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
      if (!folderExists(working, parentStored) || !isFree(working, stored)) {
        fail();
      }
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
      const prefix = `${stored}/`;
      const toDelete: string[] = [];
      for (const key of working.keys()) {
        if (key.startsWith(prefix)) toDelete.push(key);
      }
      for (const key of toDelete) working.delete(key);
      trailers.push(`${TRAILER.delete}: ${stored}`);
      break;
    }
    case "rename-note": {
      const fromStored = await storedPathOf(change.from);
      const toStored = await storedPathOf(change.to);
      const toParentStored = await storedPathOf(change.to.slice(0, -1));
      const entry = working.get(fromStored);
      if (
        entry === undefined ||
        !isFree(working, toStored) ||
        !folderExists(working, toParentStored)
      ) {
        fail();
      }
      working.delete(fromStored);
      working.set(toStored, entry);
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
      const fromPrefix = `${fromStored}/`;
      const moves: [oldKey: string, newKey: string, value: WorkingEntry][] = [];
      for (const [key, value] of working) {
        if (key.startsWith(fromPrefix)) {
          moves.push([
            key,
            `${toStored}/${key.slice(fromPrefix.length)}`,
            value,
          ]);
        }
      }
      for (const [oldKey] of moves) working.delete(oldKey);
      for (const [, newKey, value] of moves) working.set(newKey, value);
      trailers.push(`${TRAILER.rename}: ${fromStored} -> ${toStored}`);
      break;
    }
  }
}

function buildMessage(subject: string, trailers: readonly string[]): string {
  const lines = [`${TRAILER.format}: ${FORMAT_VERSION}`, ...trailers];
  return `${subject}\n\n${lines.join("\n")}`;
}

export function encodeInitializeMessage(): string {
  return buildMessage(INITIALIZE_SUBJECT, []);
}

export async function encodeChangeSet(
  input: EncodeChangeSetInput,
): Promise<EncodedChangeSet> {
  const { listing, changeSet, keyring, random } = input;

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

  for (let index = 0; index < changeSet.length; index++) {
    await applyChange(working, storedPathOf, changeSet[index], index, trailers);
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
