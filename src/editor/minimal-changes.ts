import type { ChangeSpec } from "@codemirror/state";
import { diffComm as untypedDiffComm } from "node-diff3";
import { DIFF_MAX_LINES } from "../history/line-diff";

type CommChunk =
  | { readonly common: string[] }
  | { readonly buffer1: string[]; readonly buffer2: string[] };

const diffComm = untypedDiffComm as unknown as (
  a: readonly string[],
  b: readonly string[],
) => CommChunk[];

function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function commonSuffixLength(a: string, b: string, limit: number): number {
  const max = Math.min(a.length, b.length, limit);
  let i = 0;
  while (
    i < max &&
    a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)
  ) {
    i++;
  }
  return i;
}

/**
 * Changes (in `oldText` coordinates, sorted and non-overlapping) that turn
 * `oldText` into `newText`, touching as few lines as practical.
 */
export function minimalChanges(
  oldText: string,
  newText: string,
): ChangeSpec[] {
  if (oldText === newText) return [];

  const prefix = commonPrefixLength(oldText, newText);
  const suffix = commonSuffixLength(
    oldText,
    newText,
    Math.min(oldText.length, newText.length) - prefix,
  );
  const oldMiddle = oldText.slice(prefix, oldText.length - suffix);
  const newMiddle = newText.slice(prefix, newText.length - suffix);

  const wholeMiddle: ChangeSpec = {
    from: prefix,
    to: oldText.length - suffix,
    insert: newMiddle,
  };

  const oldLines = splitLines(oldMiddle);
  const newLines = splitLines(newMiddle);
  if (
    oldLines.length === 0 ||
    newLines.length === 0 ||
    oldLines.length > DIFF_MAX_LINES ||
    newLines.length > DIFF_MAX_LINES
  ) {
    return [wholeMiddle];
  }

  const changes: ChangeSpec[] = [];
  let offset = prefix;
  for (const chunk of diffComm(oldLines, newLines)) {
    if ("common" in chunk) {
      for (const line of chunk.common) offset += line.length;
      continue;
    }
    const removedLength = chunk.buffer1.reduce((n, line) => n + line.length, 0);
    changes.push({
      from: offset,
      to: offset + removedLength,
      insert: chunk.buffer2.join(""),
    });
    offset += removedLength;
  }
  return changes;
}
