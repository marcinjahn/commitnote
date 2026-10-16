import type { NotePath } from "../changes/change";
import { parseCommitMessage } from "../changes/commit-message";
import { TRAILER } from "../format/v1";
import type { CommitSummary, ListCommitsRequest } from "../forge/forge-adapter";
import { findRemoteRename, findTrashedLocation } from "../merge/remote-rename";
import type { TrashEntry } from "../trash/trash-index";
import type { NoteTree } from "../tree/note-tree";
import { findNode, listNotes } from "../tree/note-tree";

function applyRename(current: string, value: string): string {
  const arrow = value.indexOf(" -> ");
  if (arrow === -1) return current;
  const from = value.slice(0, arrow);
  const to = value.slice(arrow + 4);
  if (current === from) return to;
  if (current.startsWith(`${from}/`)) return to + current.slice(from.length);
  return current;
}

async function relocatedStoredPath(
  oldStoredPath: string,
  newHead: string,
  listCommits: (
    request: ListCommitsRequest,
  ) => Promise<readonly CommitSummary[]>,
): Promise<string | null> {
  try {
    const commits = await listCommits({
      from: newHead,
      path: oldStoredPath,
      limit: 1,
    });
    if (commits.length === 0) return null;
    let current = oldStoredPath;
    for (const { key, value } of parseCommitMessage(commits[0].message)
      .trailers) {
      if (key === TRAILER.rename) current = applyRename(current, value);
    }
    return current === oldStoredPath ? null : current;
  } catch {
    return null;
  }
}

export async function locateRemoteRelocation(input: {
  readonly previousTree: NoteTree;
  readonly newTree: NoteTree;
  readonly newHead: string;
  readonly newTrash: readonly TrashEntry[];
  readonly path: NotePath;
  readonly listCommits: (
    request: ListCommitsRequest,
  ) => Promise<readonly CommitSummary[]>;
}): Promise<NotePath | null> {
  const { previousTree, newTree, path } = input;
  const previous = findNode(previousTree, path);
  if (previous?.kind !== "note") return null;
  if (findNode(newTree, path)?.kind === "note") return null;

  const byBlob = findRemoteRename(previousTree, newTree, path);
  if (byBlob !== null) return byBlob;
  if (findTrashedLocation(input.newTrash, path) !== null) return null;

  const stored = await relocatedStoredPath(
    previous.storedPath,
    input.newHead,
    input.listCommits,
  );
  if (stored === null) return null;
  return (
    listNotes(newTree).find((note) => note.storedPath === stored)?.path ?? null
  );
}
