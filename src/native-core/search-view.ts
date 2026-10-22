import { rowView, type SearchRow as MatchRow } from "../search/search-results";
import { toSegments } from "../search/search-text";
import type { SearchRow } from "./api";

export function toSearchRows(rows: readonly MatchRow[]): SearchRow[] {
  return rows.map((row) => {
    const view = rowView(row);
    return {
      path: [...view.path],
      name: view.name,
      folder:
        view.folders.length === 0
          ? null
          : view.folders.map((part) => part.text).join(" / "),
      nameRanges: view.nameRanges.map((range) => [range.start, range.end]),
      snippet:
        view.snippet === null
          ? null
          : toSegments(view.snippet.text, view.snippet.ranges),
      colorTag: view.colorTag,
    };
  });
}
