import { diff3Merge } from "node-diff3";
import {
  type ConflictMarkerLabels,
  PLAIN_CONFLICT_LABELS,
} from "./conflict-labels";

export interface ConflictHunk {
  readonly mine: string;
  readonly base: string;
  readonly theirs: string;
}

export type TextMergeResult =
  | { readonly kind: "clean"; readonly text: string }
  | {
      readonly kind: "conflict";
      readonly text: string;
      readonly hunks: readonly ConflictHunk[];
    };

export const CONFLICT_MARKER_PREFIX = {
  mine: "<<<<<<<",
  separator: "=======",
  theirs: ">>>>>>>",
} as const;

export type ConflictMarkerKind = keyof typeof CONFLICT_MARKER_PREFIX;

const MARKER_KINDS: readonly ConflictMarkerKind[] = [
  "mine",
  "separator",
  "theirs",
];

export function conflictMarkerKind(line: string): ConflictMarkerKind | null {
  const text = line.endsWith("\r") ? line.slice(0, -1) : line;
  for (const kind of MARKER_KINDS) {
    const prefix = CONFLICT_MARKER_PREFIX[kind];
    if (
      text.startsWith(prefix) &&
      (text.length === prefix.length || text[prefix.length] === " ")
    ) {
      return kind;
    }
  }
  return null;
}

function splitLines(text: string): string[] {
  return text.split("\n");
}

export function mergeText(
  base: string,
  mine: string,
  theirs: string,
  labels: ConflictMarkerLabels = PLAIN_CONFLICT_LABELS,
): TextMergeResult {
  if (mine === theirs) {
    return { kind: "clean", text: mine };
  }
  if (mine === base) {
    return { kind: "clean", text: theirs };
  }
  if (theirs === base) {
    return { kind: "clean", text: mine };
  }

  const mineLines = splitLines(mine);
  const baseLines = splitLines(base);
  const theirsLines = splitLines(theirs);

  const regions = diff3Merge(mineLines, baseLines, theirsLines, {
    excludeFalseConflicts: true,
  });

  const outLines: string[] = [];
  const hunks: ConflictHunk[] = [];

  for (const region of regions) {
    if (region.ok) {
      outLines.push(...region.ok);
    } else if (region.conflict) {
      const { a: mineHunk, b: theirsHunk, o: baseHunk } = region.conflict;
      outLines.push(`${CONFLICT_MARKER_PREFIX.mine} ${labels.mine}`);
      outLines.push(...mineHunk);
      outLines.push(CONFLICT_MARKER_PREFIX.separator);
      outLines.push(...theirsHunk);
      outLines.push(`${CONFLICT_MARKER_PREFIX.theirs} ${labels.theirs}`);
      hunks.push({
        mine: mineHunk.join("\n"),
        base: baseHunk.join("\n"),
        theirs: theirsHunk.join("\n"),
      });
    }
  }

  const text = outLines.join("\n");

  if (hunks.length === 0) {
    return { kind: "clean", text };
  }
  return { kind: "conflict", text, hunks };
}
