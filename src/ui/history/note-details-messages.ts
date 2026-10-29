import type { TaskProgress } from "../../tree/note-stats";
import { dayKey } from "./history-messages";

export const NOT_SAVED_YET_LABEL = "Not saved yet";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RELATIVE_DAYS_LIMIT = 7;

export interface DetailItemText {
  readonly label: string;
  readonly value: string;
}

function describeDate(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(ms);
}

export function describeCreated(
  created: { at: number; exact: boolean },
  locale?: string,
): DetailItemText {
  return {
    label: created.exact ? "Created" : "Created before",
    value: describeDate(created.at, locale),
  };
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
): DetailItemText {
  const label = "Updated";
  const elapsed = now - at;
  if (elapsed < MINUTE) return { label, value: "just now" };
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (elapsed < HOUR) {
    return {
      label,
      value: relative.format(-Math.floor(elapsed / MINUTE), "minute"),
    };
  }
  if (elapsed < DAY) {
    return {
      label,
      value: relative.format(-Math.floor(elapsed / HOUR), "hour"),
    };
  }
  const days = Math.max(1, calendarDaysBetween(at, now));
  if (days < RELATIVE_DAYS_LIMIT) {
    return { label, value: relative.format(-days, "day") };
  }
  return { label, value: describeDate(at, locale) };
}

export function describeWordCount(
  count: number,
  locale?: string,
): DetailItemText {
  return {
    value: new Intl.NumberFormat(locale).format(count),
    label: count === 1 ? "word" : "words",
  };
}

export function describeTaskProgress(
  progress: TaskProgress,
  locale?: string,
): DetailItemText {
  const format = new Intl.NumberFormat(locale);
  return {
    value: `${format.format(progress.done)}/${format.format(progress.total)}`,
    label: "tasks done",
  };
}
