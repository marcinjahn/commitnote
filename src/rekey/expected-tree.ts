import { utf8Encode } from "../crypto/base64";
import type { CommitFileChange, TreeEntry } from "../forge/forge-adapter";

async function gitBlobSha(text: string): Promise<string> {
  const content = utf8Encode(text);
  const header = utf8Encode(`blob ${content.byteLength}\0`);
  const bytes = new Uint8Array(header.byteLength + content.byteLength);
  bytes.set(header, 0);
  bytes.set(content, header.byteLength);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Blob SHA of every file that `changes` leave on top of `listing`. */
export async function expectedTree(
  listing: readonly TreeEntry[],
  changes: readonly CommitFileChange[],
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of listing) {
    if (entry.type === "blob") files.set(entry.path, entry.sha);
  }
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
