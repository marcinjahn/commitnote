import {
  blobShasByPath,
  type CommitFileChange,
  type TreeEntry,
} from "../forge/forge-adapter";
import { gitBlobSha } from "../forge/git-blob-sha";

/** Blob SHA of every file that `changes` leave on top of `listing`. */
export async function expectedTree(
  listing: readonly TreeEntry[],
  changes: readonly CommitFileChange[],
): Promise<Map<string, string>> {
  const files = blobShasByPath(listing);
  for (const change of changes) {
    switch (change.kind) {
      case "delete":
        files.delete(change.path);
        break;
      case "upsert-blob":
        files.set(change.path, change.blobSha);
        break;
      case "upsert-text":
        files.set(change.path, await gitBlobSha(change.text));
        break;
    }
  }
  return files;
}

export function sameTree(
  expected: ReadonlyMap<string, string>,
  listing: readonly TreeEntry[],
): boolean {
  const blobs = listing.filter((entry) => entry.type === "blob");
  return (
    blobs.length === expected.size &&
    blobs.every((entry) => expected.get(entry.path) === entry.sha)
  );
}
