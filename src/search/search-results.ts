import type { NotePath } from "../changes/change";
import type { ColorTag } from "../tags/color-tag";
import type { SearchSource } from "../sync/search-source";
import { describeResultCount } from "../ui/search/search-messages";
import type { IndexerState } from "./content-indexer";
import type { ContentMatch, MatchSection, NameMatch } from "./search-ranking";
import type { TextRange } from "./search-text";

export interface SearchRow {
  readonly key: string;
  readonly match: NameMatch | ContentMatch;
}

export interface SearchRowView {
  readonly key: string;
  readonly path: NotePath;
  readonly name: string;
  readonly colorTag: ColorTag | null;
  readonly nameRanges: readonly TextRange[];
  readonly folders: readonly { readonly text: string; readonly ranges: readonly TextRange[] }[];
  readonly snippet: { readonly text: string; readonly ranges: readonly TextRange[] } | null;
}

function toRow(match: NameMatch | ContentMatch): SearchRow {
  return { key: JSON.stringify(match.source.path), match };
}

export function recentRows(
  recent: readonly NotePath[],
  current: NotePath | null,
  sources: readonly SearchSource[],
): SearchRow[] {
  const byKey = new Map(sources.map((source) => [JSON.stringify(source.path), source]));
  const currentKey = current === null ? null : JSON.stringify(current);
  return recent.flatMap((path) => {
    if (JSON.stringify(path) === currentKey) return [];
    const source = byKey.get(JSON.stringify(path));
    return source === undefined ? [] : [toRow({ source, nameRanges: [], folderRanges: [] })];
  });
}

export function nameRows(section: MatchSection<NameMatch>): SearchRow[] {
  return section.matches.map(toRow);
}

export function contentRows(section: MatchSection<ContentMatch>): SearchRow[] {
  return section.matches.map(toRow);
}

export function rowView(row: SearchRow): SearchRowView {
  const { match } = row;
  return {
    key: row.key,
    path: match.source.path,
    name: match.source.name,
    colorTag: match.source.colorTag,
    nameRanges: match.nameRanges,
    folders: match.source.path
      .slice(0, -1)
      .map((text, i) => ({ text, ranges: match.folderRanges[i] ?? [] })),
    snippet: "snippet" in match ? match.snippet : null,
  };
}

export function resultCountText(
  hasTerms: boolean,
  contentsSettled: boolean,
  rowCount: number,
): string {
  return !hasTerms || !contentsSettled ? "" : describeResultCount(rowCount);
}

export function searchProgress(state: IndexerState): number | null {
  const { status } = state;
  return status.kind === "indexing" && status.total > 0 ? status.done / status.total : null;
}

export function isPartial(state: IndexerState): boolean {
  return state.status.kind !== "complete";
}
