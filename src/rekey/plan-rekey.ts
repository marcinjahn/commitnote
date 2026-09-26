import type { Keyring } from "../crypto/keyring";
import { decryptName, encryptName } from "../crypto/name-cipher";
import { decryptNote, encryptNote } from "../crypto/note-cipher";
import type { RandomSource } from "../crypto/random";
import type { CommitFileChange, TreeEntry } from "../forge/forge-adapter";
import {
  FOLDER_MARKER,
  NOTE_PREFIX,
  REPO_CONFIG_DIR,
  REPO_CONFIG_PATH,
  TRASH_DIR,
} from "../format/v1";
import { parseTrashEntryId } from "../trash/trash-entry-id";

/**
 * `other` files can't be fully decrypted (a README, an undecryptable trash
 * entry, ...). They are carried over: path segments that do decrypt are
 * re-encrypted, the rest is kept verbatim, and their contents are
 * re-encrypted only if they decrypt under the old key. So nothing readable
 * with the old key is left behind.
 */
export type RekeyFileKind = "config" | "note" | "folder" | "other";

export type RekeyFileContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "unchanged"; readonly blobSha: string };

export interface RekeyFile {
  readonly oldPath: string;
  readonly newPath: string;
  readonly kind: RekeyFileKind;
  readonly trashEntryId: string | null;
  readonly content: RekeyFileContent;
}

export interface RekeySummary {
  readonly notes: number;
  readonly folders: number;
  /** Trash entries that are re-encrypted. */
  readonly trashEntries: number;
  /** Trash entries kept as they are because they can't be decrypted. */
  readonly carriedTrashEntries: number;
  /** Files outside the trash kept as they are (a README, for example). */
  readonly carriedFiles: number;
}

export interface RekeyPlan {
  readonly files: readonly RekeyFile[];
  readonly changes: readonly CommitFileChange[];
  readonly summary: RekeySummary;
}

export type RekeyPlanErrorKind =
  "noConfig" | "undecryptableNote" | "invalidName";

export class RekeyPlanError extends Error {
  readonly kind: RekeyPlanErrorKind;

  constructor(kind: RekeyPlanErrorKind) {
    super(`Re-encryption plan failed: ${kind}`);
    this.name = "RekeyPlanError";
    this.kind = kind;
  }
}

export interface PlanRekeyInput {
  readonly listing: readonly TreeEntry[];
  /** Text of every blob in `listing`, by blob SHA. */
  readonly contents: ReadonlyMap<string, string>;
  readonly oldKeyring: Keyring;
  readonly newKeyring: Keyring;
  readonly newConfigText: string;
  readonly random?: RandomSource;
  readonly onProgress?: (done: number, total: number) => void;
}

const TRASH_PREFIX = `${TRASH_DIR}/`;
const CONFIG_DIR_PREFIX = `${REPO_CONFIG_DIR}/`;

interface SplitPath {
  readonly prefix: readonly string[];
  readonly inner: readonly string[];
  readonly trashEntryId: string | null;
}

function splitStoredPath(path: string): SplitPath | null {
  const segments = path.split("/");
  if (path.startsWith(TRASH_PREFIX) && segments.length > 3) {
    const id = segments[2];
    if (parseTrashEntryId(id) !== null) {
      return {
        prefix: segments.slice(0, 3),
        inner: segments.slice(3),
        trashEntryId: id,
      };
    }
  }
  if (path.startsWith(CONFIG_DIR_PREFIX)) return null;
  return { prefix: [], inner: segments, trashEntryId: null };
}

function comparePaths(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

export function rekeyChanges(files: readonly RekeyFile[]): CommitFileChange[] {
  const changes: CommitFileChange[] = [];
  for (const file of files) {
    const moved = file.newPath !== file.oldPath;
    if (moved) changes.push({ kind: "delete", path: file.oldPath });
    if (file.content.kind === "text") {
      changes.push({
        kind: "upsert-text",
        path: file.newPath,
        text: file.content.text,
      });
    } else if (moved) {
      changes.push({
        kind: "upsert-blob",
        path: file.newPath,
        blobSha: file.content.blobSha,
      });
    }
  }
  return changes.sort(comparePaths);
}

export async function planRekey(input: PlanRekeyInput): Promise<RekeyPlan> {
  const { contents, oldKeyring, newKeyring, random } = input;
  const blobs = input.listing.filter((entry) => entry.type === "blob");
  if (!blobs.some((entry) => entry.path === REPO_CONFIG_PATH)) {
    throw new RekeyPlanError("noConfig");
  }

  const decryptedSegments = new Map<string, Promise<string | null>>();
  const encryptedNames = new Map<string, Promise<string>>();
  function oldName(segment: string): Promise<string | null> {
    let name = decryptedSegments.get(segment);
    if (name === undefined) {
      name = decryptName(oldKeyring, segment);
      decryptedSegments.set(segment, name);
    }
    return name;
  }
  function newSegment(name: string): Promise<string> {
    let segment = encryptedNames.get(name);
    if (segment === undefined) {
      segment = encryptName(newKeyring, name);
      encryptedNames.set(name, segment);
    }
    return segment;
  }

  function textOf(sha: string): string {
    const text = contents.get(sha);
    if (text === undefined) throw new Error("Blob contents were not read");
    return text;
  }

  async function reencryptIfOldKey(
    sha: string,
  ): Promise<RekeyFileContent | null> {
    const text = textOf(sha);
    if (!text.startsWith(NOTE_PREFIX)) return null;
    let plaintext: string;
    try {
      plaintext = await decryptNote(oldKeyring, text);
    } catch {
      return null;
    }
    return {
      kind: "text",
      text: await encryptNote(newKeyring, plaintext, random),
    };
  }

  const files: RekeyFile[] = [];
  const folders = new Set<string>();
  const readableTrash = new Set<string>();
  const carriedTrash = new Set<string>();
  let notes = 0;
  let carriedFiles = 0;

  for (let index = 0; index < blobs.length; index++) {
    input.onProgress?.(index, blobs.length);
    const entry = blobs[index];

    if (entry.path === REPO_CONFIG_PATH) {
      files.push({
        oldPath: entry.path,
        newPath: entry.path,
        kind: "config",
        trashEntryId: null,
        content: { kind: "text", text: input.newConfigText },
      });
      continue;
    }

    const split = splitStoredPath(entry.path);
    const prefix = split?.prefix ?? [];
    const inner = split?.inner ?? entry.path.split("/");
    const trashEntryId = split?.trashEntryId ?? null;

    const marker =
      inner.length > 1 && inner[inner.length - 1] === FOLDER_MARKER;
    const named = marker ? inner.slice(0, -1) : inner;
    const newInner: string[] = [];
    let fullyDecrypted = split !== null;
    for (const segment of named) {
      const name = split === null ? null : await oldName(segment);
      if (name === null) {
        fullyDecrypted = false;
        newInner.push(segment);
        continue;
      }
      try {
        newInner.push(await newSegment(name));
      } catch (error) {
        if (error instanceof RangeError)
          throw new RekeyPlanError("invalidName");
        throw error;
      }
    }
    if (marker) newInner.push(FOLDER_MARKER);
    const newPath = [...prefix, ...newInner].join("/");

    let kind: RekeyFileKind;
    let content: RekeyFileContent;
    if (fullyDecrypted && !marker) {
      const reencrypted = await reencryptIfOldKey(entry.sha);
      if (reencrypted === null && trashEntryId === null) {
        throw new RekeyPlanError("undecryptableNote");
      }
      kind = reencrypted === null ? "other" : "note";
      content = reencrypted ?? { kind: "unchanged", blobSha: entry.sha };
    } else {
      kind = fullyDecrypted ? "folder" : "other";
      content = (await reencryptIfOldKey(entry.sha)) ?? {
        kind: "unchanged",
        blobSha: entry.sha,
      };
    }

    if (trashEntryId !== null) {
      (kind === "other" ? carriedTrash : readableTrash).add(trashEntryId);
    } else if (kind === "other") {
      carriedFiles++;
    } else {
      if (kind === "note") notes++;
      for (let depth = 1; depth < named.length + (marker ? 1 : 0); depth++) {
        folders.add(named.slice(0, depth).join("/"));
      }
    }

    files.push({ oldPath: entry.path, newPath, kind, trashEntryId, content });
  }
  input.onProgress?.(blobs.length, blobs.length);

  for (const id of carriedTrash) readableTrash.delete(id);

  return {
    files,
    changes: rekeyChanges(files),
    summary: {
      notes,
      folders: folders.size,
      trashEntries: readableTrash.size,
      carriedTrashEntries: carriedTrash.size,
      carriedFiles,
    },
  };
}
