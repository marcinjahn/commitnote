import type { SearchSource } from "../sync/search-source";
import { compareNames } from "../tree/note-names";
import {
  findOccurrences,
  fold,
  isWordStart,
  mergeRanges,
  type IndexedContent,
  type TextRange,
} from "./search-text";
import { OCCURRENCE_SCORE_CAP, RESULT_CAP, SNIPPET_LEAD, SNIPPET_LENGTH } from "./search-tuning";

export interface NameMatch {
  readonly source: SearchSource;
  readonly nameRanges: readonly TextRange[];
  readonly folderRanges: readonly (readonly TextRange[])[];
}

export interface ContentMatch extends NameMatch {
  readonly snippet: { readonly text: string; readonly ranges: readonly TextRange[] };
}

export interface MatchSection<T> {
  readonly matches: readonly T[];
  readonly more: boolean;
}

const EMPTY_SECTION: MatchSection<never> = { matches: [], more: false };

interface Analysis {
  readonly source: SearchSource;
  readonly foldedName: string;
  readonly nameHits: readonly string[];
  readonly allInName: boolean;
  readonly allCovered: boolean;
}

function analyze(source: SearchSource, terms: readonly string[]): Analysis {
  const foldedName = fold(source.name);
  const folders = source.path.slice(0, -1).map(fold);
  const nameHits = terms.filter((t) => foldedName.includes(t));
  const allInName = nameHits.length === terms.length;
  const allCovered = terms.every((t) => foldedName.includes(t) || folders.some((f) => f.includes(t)));
  return { source, foldedName, nameHits, allInName, allCovered };
}

function nameTier(a: Analysis, terms: readonly string[]): number {
  if (a.foldedName === terms.join(" ")) return 0;
  if (a.nameHits.some((t) => a.foldedName.startsWith(t))) return 1;
  const wordStart = a.nameHits.some((t) =>
    findOccurrences(a.foldedName, t).some((r) => isWordStart(a.foldedName, r.start)),
  );
  return wordStart ? 2 : 3;
}

function highlights(source: SearchSource, terms: readonly string[]): NameMatch {
  const rangesIn = (text: string) =>
    mergeRanges(terms.flatMap((t) => findOccurrences(fold(text), t)));
  return {
    source,
    nameRanges: rangesIn(source.name),
    folderRanges: source.path.slice(0, -1).map(rangesIn),
  };
}

function compareSources(a: SearchSource, b: SearchSource): number {
  return compareNames(a.name, b.name) || compareNames(a.path.join("/"), b.path.join("/"));
}

function cap<T>(sorted: readonly T[]): MatchSection<T> {
  return { matches: sorted.slice(0, RESULT_CAP), more: sorted.length > RESULT_CAP };
}

export function matchNames(
  sources: readonly SearchSource[],
  terms: readonly string[],
): MatchSection<NameMatch> {
  if (terms.length === 0) return EMPTY_SECTION;
  const scored = sources
    .map((s) => analyze(s, terms))
    .filter((a) => a.nameHits.length > 0 && a.allCovered)
    .map((a) => ({ a, tier: nameTier(a, terms) }));
  scored.sort(
    (x, y) =>
      x.tier - y.tier ||
      Number(y.a.allInName) - Number(x.a.allInName) ||
      compareSources(x.a.source, y.a.source),
  );
  return cap(scored.map(({ a }) => highlights(a.source, terms)));
}

function buildSnippet(
  content: IndexedContent,
  terms: readonly string[],
): ContentMatch["snippet"] {
  const { text, folded } = content;
  const all = terms.flatMap((t) => findOccurrences(folded, t));
  const first = Math.min(...all.map((r) => r.start));
  const start = Math.max(0, first - SNIPPET_LEAD);
  const end = Math.min(text.length, start + SNIPPET_LENGTH);

  let collapsed = "";
  const indexMap: number[] = [];
  let inSpace = false;
  for (let i = start; i < end; i++) {
    if (/\s/.test(text[i])) {
      if (!inSpace) collapsed += " ";
      inSpace = true;
    } else {
      collapsed += text[i];
      inSpace = false;
    }
    indexMap.push(collapsed.length - 1);
  }

  const lead = collapsed.length - collapsed.trimStart().length;
  const trimmed = collapsed.trim();
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";

  const ranges: TextRange[] = [];
  for (const r of all) {
    const s = Math.max(r.start, start);
    const e = Math.min(r.end, end);
    if (s >= e) continue;
    const from = Math.max(indexMap[s - start] - lead, 0);
    const to = Math.min(indexMap[e - 1 - start] + 1 - lead, trimmed.length);
    if (from < to) ranges.push({ start: from + prefix.length, end: to + prefix.length });
  }

  return { text: prefix + trimmed + suffix, ranges: mergeRanges(ranges) };
}

export function matchContents(
  sources: readonly SearchSource[],
  terms: readonly string[],
  contentFor: (source: SearchSource) => IndexedContent | undefined,
): MatchSection<ContentMatch> {
  if (terms.length === 0) return EMPTY_SECTION;
  const scored: { source: SearchSource; content: IndexedContent; score: number }[] = [];
  for (const source of sources) {
    const a = analyze(source, terms);
    if (a.nameHits.length > 0 && a.allCovered) continue;
    const content = contentFor(source);
    if (!content) continue;
    let score = 0;
    let everyTerm = true;
    for (const t of terms) {
      const count = findOccurrences(content.folded, t).length;
      if (count === 0) {
        everyTerm = false;
        break;
      }
      score += Math.min(count, OCCURRENCE_SCORE_CAP);
    }
    if (everyTerm) scored.push({ source, content, score });
  }
  scored.sort((x, y) => y.score - x.score || compareSources(x.source, y.source));
  const top = cap(scored);
  return {
    matches: top.matches.map(({ source, content }) => ({
      ...highlights(source, terms),
      snippet: buildSnippet(content, terms),
    })),
    more: top.more,
  };
}
