import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { decryptPath } from "../crypto/name-cipher";
import type { TreeEntry } from "../forge/forge-adapter";
import { TRASH_DIR } from "../format/v1";
import { buildNoteTree, findNode, type TreeNode } from "../tree/note-tree";
import { parseTrashEntryId } from "./trash-entry-id";

interface TrashFile {
  /** Full repo path, including the `.commitnote/trash/<entryId>/` prefix. */
  readonly storedPath: string;
  readonly sha: string;
}

interface TrashEntryBase {
  readonly id: string;
  readonly deletedAt: number;
  readonly files: readonly TrashFile[];
}

interface ReadableTrashEntry extends TrashEntryBase {
  readonly undecryptable: false;
  readonly kind: "note" | "folder";
  readonly originalPath: NotePath;
  /** Original stored path of the item, without the trash prefix. */
  readonly storedRoot: string;
  /** Paths and stored paths in this tree are the original, untrashed ones. */
  readonly tree: TreeNode;
}

/**
 * Kept so it can still be purged by id; it must not be shown or restored.
 */
interface UndecryptableTrashEntry extends TrashEntryBase {
  readonly undecryptable: true;
}

export type TrashEntry = ReadableTrashEntry | UndecryptableTrashEntry;

const TRASH_PREFIX = `${TRASH_DIR}/`;

export async function buildTrashIndex(
  listing: readonly TreeEntry[],
  keyring: Keyring,
): Promise<TrashEntry[]> {
  const filesById = new Map<string, TrashFile[]>();
  for (const entry of listing) {
    if (entry.type !== "blob" || !entry.path.startsWith(TRASH_PREFIX)) continue;
    const rest = entry.path.slice(TRASH_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) continue;
    const id = rest.slice(0, slash);
    let files = filesById.get(id);
    if (files === undefined) {
      files = [];
      filesById.set(id, files);
    }
    files.push({ storedPath: entry.path, sha: entry.sha });
  }

  const entries: TrashEntry[] = [];
  for (const [id, files] of filesById) {
    const parsed = parseTrashEntryId(id);
    if (parsed === null) continue;
    entries.push(
      await readEntry(id, parsed.deletedAt, parsed.depth, files, keyring),
    );
  }
  return entries.sort(compareEntries);
}

function compareEntries(a: TrashEntry, b: TrashEntry): number {
  if (a.deletedAt !== b.deletedAt) return a.deletedAt - b.deletedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

async function readEntry(
  id: string,
  deletedAt: number,
  depth: number,
  files: readonly TrashFile[],
  keyring: Keyring,
): Promise<TrashEntry> {
  const undecryptable: UndecryptableTrashEntry = {
    id,
    deletedAt,
    files,
    undecryptable: true,
  };

  const entryPrefix = `${TRASH_PREFIX}${id}/`;
  const innerPaths = files.map((file) =>
    file.storedPath.slice(entryPrefix.length),
  );

  const rootSegments = innerPaths[0].split("/").slice(0, depth);
  if (rootSegments.length !== depth) return undecryptable;
  const storedRoot = rootSegments.join("/");

  let isNote = false;
  for (const path of innerPaths) {
    if (path === storedRoot) {
      isNote = true;
    } else if (!path.startsWith(`${storedRoot}/`)) {
      return undecryptable;
    }
  }
  if (isNote && innerPaths.length !== 1) return undecryptable;

  const originalPath = await decryptPath(keyring, storedRoot);
  if (originalPath === null) return undecryptable;

  const decrypted = await buildNoteTree(
    innerListingOf(files, innerPaths),
    keyring,
  );
  const tree = findNode(decrypted, originalPath);
  if (tree === undefined || tree.kind !== (isNote ? "note" : "folder")) {
    return undecryptable;
  }

  return {
    id,
    deletedAt,
    files,
    undecryptable: false,
    kind: tree.kind,
    originalPath,
    storedRoot,
    tree,
  };
}

function innerListingOf(
  files: readonly TrashFile[],
  innerPaths: readonly string[],
): TreeEntry[] {
  const listing: TreeEntry[] = files.map((file, index) => ({
    path: innerPaths[index],
    type: "blob",
    sha: file.sha,
  }));
  const folders = new Set<string>();
  for (const path of innerPaths) {
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i++) {
      folders.add(segments.slice(0, i).join("/"));
    }
  }
  for (const folder of folders) {
    listing.push({ path: folder, type: "tree", sha: "" });
  }
  return listing;
}
