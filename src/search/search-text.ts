import { FOLD_TABLE } from "./search-tuning";

const unitCache = new Map<string, string>();

function foldUnit(c: string): string {
  const cached = unitCache.get(c);
  if (cached !== undefined) return cached;
  const code = c.charCodeAt(0);
  let result = c;
  if (code < 0xd800 || code > 0xdfff) {
    const lower = c.toLowerCase();
    if (lower.length === 1) {
      const stripped = lower.normalize("NFD").replace(/\p{M}/gu, "");
      const base = stripped.length === 1 ? stripped : lower;
      result = FOLD_TABLE[base] ?? base;
    }
  }
  unitCache.set(c, result);
  return result;
}

export function fold(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += foldUnit(text[i]);
  return out;
}

export function parseTerms(query: string): readonly string[] {
  const terms = fold(query)
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return [...new Set(terms)];
}

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export function findOccurrences(folded: string, term: string): TextRange[] {
  const ranges: TextRange[] = [];
  if (term.length === 0) return ranges;
  let from = 0;
  for (;;) {
    const at = folded.indexOf(term, from);
    if (at === -1) return ranges;
    ranges.push({ start: at, end: at + term.length });
    from = at + term.length;
  }
}

export function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) merged[merged.length - 1] = { start: last.start, end: range.end };
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

export interface TextSegment {
  readonly text: string;
  readonly match: boolean;
}

export function toSegments(text: string, ranges: readonly TextRange[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let pos = 0;
  for (const { start, end } of mergeRanges(ranges)) {
    if (start > pos) segments.push({ text: text.slice(pos, start), match: false });
    if (end > start) segments.push({ text: text.slice(start, end), match: true });
    pos = Math.max(pos, end);
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), match: false });
  return segments;
}

export function isWordStart(text: string, index: number): boolean {
  return index === 0 || !/[\p{L}\p{N}]/u.test(text[index - 1]);
}

export interface IndexedContent {
  readonly text: string;
  readonly folded: string;
}

export function indexContent(text: string): IndexedContent {
  return { text, folded: fold(text) };
}
