import { markdownLanguage } from "@codemirror/lang-markdown";
import { dayKey } from "./history-messages";

export const NOT_SAVED_YET_LABEL = "Not saved yet";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RELATIVE_DAYS_LIMIT = 7;

function describeDate(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(ms);
}

export function describeCreated(
  created: { at: number; exact: boolean },
  locale?: string,
): string {
  const date = describeDate(created.at, locale);
  return created.exact ? `Created ${date}` : `Created before ${date}`;
}

function calendarDaysBetween(from: number, to: number): number {
  const a = new Date(dayKey(from));
  const b = new Date(dayKey(to));
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      DAY,
  );
}

export function describeUpdated(
  at: number,
  now: number,
  locale?: string,
): string {
  const elapsed = now - at;
  if (elapsed < MINUTE) return "Updated just now";
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (elapsed < HOUR) {
    return `Updated ${relative.format(-Math.floor(elapsed / MINUTE), "minute")}`;
  }
  if (elapsed < DAY) {
    return `Updated ${relative.format(-Math.floor(elapsed / HOUR), "hour")}`;
  }
  const days = Math.max(1, calendarDaysBetween(at, now));
  if (days < RELATIVE_DAYS_LIMIT) {
    return `Updated ${relative.format(-days, "day")}`;
  }
  return `Updated ${describeDate(at, locale)}`;
}

const segmenters = new Map<string | undefined, Intl.Segmenter>();

export function countWords(text: string, locale?: string): number {
  let segmenter = segmenters.get(locale);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(locale, { granularity: "word" });
    segmenters.set(locale, segmenter);
  }
  let count = 0;
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) count++;
  }
  return count;
}

export function describeWordCount(count: number, locale?: string): string {
  const unit = count === 1 ? "word" : "words";
  return `${new Intl.NumberFormat(locale).format(count)} ${unit}`;
}

export interface TaskProgress {
  readonly done: number;
  readonly total: number;
}

export function countTasks(text: string): TaskProgress {
  let done = 0;
  let total = 0;
  markdownLanguage.parser.parse(text).iterate({
    enter(node) {
      if (node.name !== "TaskMarker") return;
      total++;
      const state = text[node.from + 1];
      if (state === "x" || state === "X") done++;
    },
  });
  return { done, total };
}

export function describeTaskProgress(
  progress: TaskProgress,
  locale?: string,
): string {
  const format = new Intl.NumberFormat(locale);
  return `${format.format(progress.done)}/${format.format(progress.total)} done`;
}
