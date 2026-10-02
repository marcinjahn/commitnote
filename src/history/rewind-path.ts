import type {
  CommitTrailer,
  ParsedCommitMessage,
} from "../changes/commit-message";
import { CHANGE_PASSPHRASE_SUBJECT, TRASH_DIR, TRAILER } from "../format/v1";

/** How the stored path of a note before a commit relates to the one after it. */
export type RewindStep =
  | {
      readonly kind: "same";
      /** No commitnote trailer of the commit names the note. */
      readonly external: boolean;
    }
  | {
      readonly kind: "moved";
      readonly before: string;
      readonly renamed: boolean;
      readonly moved: boolean;
    }
  /** Moved into the trash; the content is the one before the commit. */
  | { readonly kind: "trashed"; readonly before: string }
  | { readonly kind: "created" }
  /** The file at the path after the commit is not the note's. */
  | { readonly kind: "deleted" }
  | {
      readonly kind: "restored";
      readonly entryId: string;
      /** Stored path the trash entry was restored to. */
      readonly to: string;
      /** The note's stored path right after the restore. */
      readonly path: string;
      /** Trailers applied before the restore, still to rewind through. */
      readonly earlier: readonly CommitTrailer[];
    }
  | { readonly kind: "passphraseChanged" };

/** `rest` of `path` below `prefix`, "" when equal, null when not inside. */
function relativeTo(path: string, prefix: string): string | null {
  if (path === prefix) return "";
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : null;
}

function join(prefix: string, rest: string): string {
  return rest === "" ? prefix : `${prefix}/${rest}`;
}

function splitArrow(value: string): readonly [string, string] | null {
  const arrow = value.indexOf(" -> ");
  if (arrow === -1) return null;
  return [value.slice(0, arrow), value.slice(arrow + 4)];
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Rewinds the stored path of a note through one commit: given its path
 * after the commit, tells where it was before.
 */
export function rewindPath(
  parsed: ParsedCommitMessage,
  pathAfter: string,
): RewindStep {
  if (parsed.subject === CHANGE_PASSPHRASE_SUBJECT) {
    return { kind: "passphraseChanged" };
  }

  let path = pathAfter;
  let mentioned = false;
  let trashed = false;
  const trailers = parsed.trailers;
  for (let index = trailers.length - 1; index >= 0; index--) {
    const { key, value } = trailers[index];
    switch (key) {
      case TRAILER.create:
        if (value === path) return { kind: "created" };
        break;
      case TRAILER.update:
        if (value === path) mentioned = true;
        break;
      case TRAILER.delete:
        if (relativeTo(path, value) !== null) return { kind: "deleted" };
        break;
      case TRAILER.rename: {
        const pair = splitArrow(value);
        if (pair === null) break;
        const rest = relativeTo(path, pair[1]);
        if (rest !== null) path = join(pair[0], rest);
        break;
      }
      case TRAILER.trash: {
        const pair = splitArrow(value);
        if (pair === null) break;
        const rest = relativeTo(path, `${TRASH_DIR}/${pair[1]}`);
        if (rest !== null && relativeTo(rest, pair[0]) !== null) {
          path = rest;
          trashed = true;
        }
        break;
      }
      case TRAILER.restore: {
        const pair = splitArrow(value);
        if (pair === null) break;
        if (relativeTo(path, pair[1]) !== null) {
          return {
            kind: "restored",
            entryId: pair[0],
            to: pair[1],
            path,
            earlier: trailers.slice(0, index),
          };
        }
        break;
      }
    }
  }

  if (path === pathAfter) {
    return {
      kind: "same",
      external: parsed.formatVersion === null || !mentioned,
    };
  }
  if (trashed && !path.startsWith(`${TRASH_DIR}/`)) {
    return { kind: "trashed", before: path };
  }
  return {
    kind: "moved",
    before: path,
    renamed: lastSegment(path) !== lastSegment(pathAfter),
    moved: parentOf(path) !== parentOf(pathAfter),
  };
}
