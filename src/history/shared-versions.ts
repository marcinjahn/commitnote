import type { ShareEntry } from "../share/share-index";
import type { NoteVersion } from "./note-history";

export function sharedVersionShas(
  shares: readonly ShareEntry[],
): ReadonlySet<string> {
  const shas = new Set<string>();
  for (const share of shares) {
    if (share.source !== null) shas.add(share.source.commit);
  }
  return shas;
}

export function isGroupShared(
  versions: readonly NoteVersion[],
  shared: ReadonlySet<string>,
): boolean {
  return versions.some((version) => shared.has(version.sha));
}
