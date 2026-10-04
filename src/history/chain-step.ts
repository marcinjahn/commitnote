import { parseCommitMessage } from "../changes/commit-message";
import type { CommitSummary, ForgeAdapter } from "../forge/forge-adapter";
import { FOLDER_MARKER, TRASH_DIR } from "../format/v1";
import { rewindPath, type RewindStep } from "./rewind-path";

export type VersionEvent =
  | "created"
  | "renamed"
  | "moved"
  | "restoredFromTrash"
  | "passphraseChanged"
  | "external";

export interface ChainStepDeps {
  readFileAt: ForgeAdapter["readFileAt"];
  listTree: ForgeAdapter["listTree"];
}

/** `events` is the version the commit contributes at the path, null for none. */
export type ChainStep =
  | { kind: "same"; events: readonly VersionEvent[] }
  | {
      kind: "relocated";
      previousPath: string;
      events: readonly VersionEvent[] | null;
    }
  | { kind: "created"; events: readonly VersionEvent[] }
  | { kind: "passphraseChanged"; events: readonly VersionEvent[] }
  | { kind: "untraceable"; events: readonly VersionEvent[] | null };

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function onlyOne<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

function movedEvents(step: Extract<RewindStep, { kind: "moved" }>) {
  const events: VersionEvent[] = [];
  if (step.renamed) events.push("renamed");
  if (step.moved) events.push("moved");
  return events;
}

export function createChainStep(
  deps: ChainStepDeps,
): (commit: CommitSummary, path: string) => Promise<ChainStep> {
  const { readFileAt, listTree } = deps;

  /** Where the restored note was in the trash before `commit`, or null. */
  async function traceRestore(
    commit: CommitSummary,
    pathAfter: string,
    step: Extract<RewindStep, { kind: "restored" }>,
  ): Promise<string | null> {
    const parent = commit.parents[0];
    if (parent === undefined) return null;
    const file = await readFileAt(commit.sha, pathAfter);
    if (file === null) return null;
    const listing = await listTree(parent);
    const rest =
      step.path === step.to ? "" : step.path.slice(step.to.length + 1);
    const entryPrefix = `${TRASH_DIR}/${step.entryId}/`;
    const inPlace = listing.filter(
      (entry) =>
        entry.type === "blob" &&
        entry.path.startsWith(entryPrefix) &&
        lastSegment(entry.path) !== FOLDER_MARKER &&
        (rest === "" || entry.path.endsWith(`/${rest}`)),
    );
    const wanted = lastSegment(step.path);
    const sameBlob = inPlace.filter((entry) => entry.sha === file.blobSha);
    // The note may also have been edited in the restoring commit, so its
    // content then no longer matches the trashed file's.
    const match =
      sameBlob.length > 0
        ? (sameBlob.find((entry) => lastSegment(entry.path) === wanted) ??
          sameBlob[0])
        : onlyOne(inPlace) ??
          onlyOne(inPlace.filter((entry) => lastSegment(entry.path) === wanted));
    if (match === undefined) return null;

    const before = rewindPath(
      { subject: "", formatVersion: null, trailers: step.earlier },
      match.path,
    );
    switch (before.kind) {
      case "same":
        return match.path;
      case "moved":
      case "trashed":
        return before.before;
      default:
        return null;
    }
  }

  return async (commit, path) => {
    const step = rewindPath(parseCommitMessage(commit.message), path);
    switch (step.kind) {
      case "same":
        return { kind: "same", events: step.external ? ["external"] : [] };
      case "moved":
        return {
          kind: "relocated",
          previousPath: step.before,
          events: movedEvents(step),
        };
      case "trashed":
        return { kind: "relocated", previousPath: step.before, events: null };
      case "created":
        return { kind: "created", events: ["created"] };
      case "deleted":
        return { kind: "untraceable", events: null };
      case "passphraseChanged":
        return { kind: "passphraseChanged", events: ["passphraseChanged"] };
      case "restored": {
        const source = await traceRestore(commit, path, step);
        const events = ["restoredFromTrash"] as const;
        return source === null
          ? { kind: "untraceable", events }
          : { kind: "relocated", previousPath: source, events };
      }
    }
  };
}
