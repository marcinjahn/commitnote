import type { IndexerState, IndexStatus } from "../../search/content-indexer";
import { describeMinutes } from "../plural";

export const NAME_SECTION_HEADING = "Titles";
export const RECENT_SECTION_HEADING = "Recent";
export const STILL_READING = "Still reading notes…";
export const SEARCH_HINT = "Search note titles and contents";
export const SEARCH_PLACEHOLDER = "Search notes";
export const SEARCH_TRIGGER_LABEL = "Search notes";

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

export function describeIndexStatus(
  status: IndexStatus,
  forgeName: string,
  now: number,
): string | null {
  switch (status.kind) {
    case "idle":
    case "complete":
      return null;
    case "indexing":
      return `Reading notes for content search… ${formatCount(status.done)} of ${formatCount(status.total)}`;
    case "paused":
      return `Content search paused: ${forgeName} rate limit. Resuming in ${describeMinutes(status.resumeAt - now)}.`;
    case "offline":
      return "Content search is offline. Some contents may be missing.";
    case "limited":
      return `Content search covers ${formatCount(status.covered)} of ${formatCount(status.total)} notes (memory limit).`;
  }
}

export function describeUnreadable(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 note couldn't be read."
    : `${formatCount(count)} notes couldn't be read.`;
}

export function describeSearchStatus(
  state: IndexerState,
  forgeName: string,
  now: number,
): string | null {
  const parts = [
    describeIndexStatus(state.status, forgeName, now),
    describeUnreadable(state.unreadable),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

export function contentSectionHeading(partial: boolean): string {
  return partial ? "Contents (partial)" : "Contents";
}

export function describeNoMatches(query: string): string {
  return `No notes match “${query.trim()}”`;
}

export function describeShowingFirst(count: number): string {
  return `Showing first ${formatCount(count)}`;
}
