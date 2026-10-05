import { diffComm as untypedDiffComm } from "node-diff3";

const DIFF_CONTEXT_LINES = 3;
export const DIFF_MAX_LINES = 20_000;
const WORD_DIFF_MAX_LINE_LENGTH = 10_000;

type CommChunk =
  | { readonly common: string[] }
  | { readonly buffer1: string[]; readonly buffer2: string[] };

const diffComm = untypedDiffComm as unknown as (
  a: readonly string[],
  b: readonly string[],
) => CommChunk[];

/** A piece of a changed line; `changed` marks the words that differ. */
interface DiffSegment {
  readonly text: string;
  readonly changed: boolean;
}

type DiffLine =
  | { readonly kind: "same"; readonly text: string }
  | {
      /** `added` comes back on restore; `removed` would be gone. */
      readonly kind: "added" | "removed";
      readonly segments: readonly DiffSegment[];
    };

export type DiffItem =
  | { readonly kind: "line"; readonly line: DiffLine }
  | { readonly kind: "fold"; readonly lines: readonly string[] };

export type NoteDiff =
  | { readonly kind: "tooLarge" }
  | {
      readonly kind: "diff";
      readonly items: readonly DiffItem[];
      readonly added: number;
      readonly removed: number;
      /** Whether restoring adds or removes the final line break. */
      readonly finalNewline: "added" | "removed" | null;
    };

function splitLines(text: string): { lines: string[]; finalNewline: boolean } {
  if (text === "") return { lines: [], finalNewline: false };
  const finalNewline = text.endsWith("\n");
  const lines = (finalNewline ? text.slice(0, -1) : text).split("\n");
  return { lines, finalNewline };
}

function wholeLine(kind: "added" | "removed", text: string): DiffItem {
  return { kind: "line", line: { kind, segments: [{ text, changed: false }] } };
}

function pushSegment(segments: DiffSegment[], text: string, changed: boolean) {
  if (text === "") return;
  const last = segments[segments.length - 1];
  if (last !== undefined && last.changed === changed) {
    segments[segments.length - 1] = { text: last.text + text, changed };
  } else {
    segments.push({ text, changed });
  }
}

/** Word-level segments of a removed/added pair, or null when nothing but whitespace is shared. */
function wordDiff(
  removed: string,
  added: string,
): { removed: DiffSegment[]; added: DiffSegment[] } | null {
  if (
    removed.length > WORD_DIFF_MAX_LINE_LENGTH ||
    added.length > WORD_DIFF_MAX_LINE_LENGTH
  ) {
    return null;
  }
  const tokens = (line: string) => line.split(/(\s+)/).filter((t) => t !== "");
  const chunks = diffComm(tokens(removed), tokens(added));
  const sharesWords = chunks.some(
    (chunk) => "common" in chunk && chunk.common.some((t) => t.trim() !== ""),
  );
  if (!sharesWords) return null;
  const out = { removed: [] as DiffSegment[], added: [] as DiffSegment[] };
  for (const chunk of chunks) {
    if ("common" in chunk) {
      const text = chunk.common.join("");
      pushSegment(out.removed, text, false);
      pushSegment(out.added, text, false);
    } else {
      pushSegment(out.removed, chunk.buffer1.join(""), true);
      pushSegment(out.added, chunk.buffer2.join(""), true);
    }
  }
  return out;
}

function changedBlock(removed: readonly string[], added: readonly string[]) {
  const removedItems = removed.map((line) => wholeLine("removed", line));
  const addedItems = added.map((line) => wholeLine("added", line));
  const pairs = Math.min(removed.length, added.length);
  for (let i = 0; i < pairs; i++) {
    const words = wordDiff(removed[i]!, added[i]!);
    if (words === null) continue;
    removedItems[i] = {
      kind: "line",
      line: { kind: "removed", segments: words.removed },
    };
    addedItems[i] = {
      kind: "line",
      line: { kind: "added", segments: words.added },
    };
  }
  return [...removedItems, ...addedItems];
}

function sameLines(lines: readonly string[]): DiffItem[] {
  return lines.map((text) => ({ kind: "line", line: { kind: "same", text } }));
}

/** Context around changes, with longer unchanged runs folded. */
function foldRun(
  lines: readonly string[],
  position: "first" | "middle" | "last",
): DiffItem[] {
  const keepBefore = position === "first" ? 0 : DIFF_CONTEXT_LINES;
  const keepAfter = position === "last" ? 0 : DIFF_CONTEXT_LINES;
  // Folding one line would take as much room as showing it.
  if (lines.length <= keepBefore + keepAfter + 1) return sameLines(lines);
  return [
    ...sameLines(lines.slice(0, keepBefore)),
    { kind: "fold", lines: lines.slice(keepBefore, lines.length - keepAfter) },
    ...sameLines(lines.slice(lines.length - keepAfter)),
  ];
}

/**
 * What restoring `selected` would change in `current`, line by line, with
 * the differing words marked within lines that were edited.
 */
export function diffNote(current: string, selected: string): NoteDiff {
  const before = splitLines(current);
  const after = splitLines(selected);
  if (
    before.lines.length > DIFF_MAX_LINES ||
    after.lines.length > DIFF_MAX_LINES
  ) {
    return { kind: "tooLarge" };
  }
  const finalNewline =
    before.finalNewline === after.finalNewline
      ? null
      : after.finalNewline
        ? "added"
        : "removed";

  const chunks = diffComm(before.lines, after.lines);
  const items: DiffItem[] = [];
  let added = 0;
  let removed = 0;
  const hasChanges = chunks.some((chunk) => !("common" in chunk));
  if (!hasChanges) {
    return { kind: "diff", items, added, removed, finalNewline };
  }
  chunks.forEach((chunk, index) => {
    if ("common" in chunk) {
      const position =
        index === 0 ? "first" : index === chunks.length - 1 ? "last" : "middle";
      items.push(...foldRun(chunk.common, position));
      return;
    }
    removed += chunk.buffer1.length;
    added += chunk.buffer2.length;
    items.push(...changedBlock(chunk.buffer1, chunk.buffer2));
  });
  return { kind: "diff", items, added, removed, finalNewline };
}
