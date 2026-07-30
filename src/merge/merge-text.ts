import { diff3Merge } from "node-diff3";

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

export const CONFLICT_MARKERS = {
  mine: "<<<<<<< mine",
  separator: "=======",
  theirs: ">>>>>>> theirs",
} as const;

function splitLines(text: string): string[] {
  return text.split("\n");
}

export function mergeText(
  base: string,
  mine: string,
  theirs: string,
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
      outLines.push(CONFLICT_MARKERS.mine);
      outLines.push(...mineHunk);
      outLines.push(CONFLICT_MARKERS.separator);
      outLines.push(...theirsHunk);
      outLines.push(CONFLICT_MARKERS.theirs);
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
