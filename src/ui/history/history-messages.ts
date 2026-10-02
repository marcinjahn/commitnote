import type { HistoryEnd, VersionEvent } from "../../history/note-history";
import type { RestoreBlock } from "../../history/plan-restore";

export const VERSION_HISTORY_LABEL = "Version history";
export const SAVING_CHANGES_MESSAGE = "Saving your changes…";
export const SAVE_FIRST_MESSAGE = "Save this note first to see its history.";
export const SAME_AS_CURRENT_MESSAGE = "Same as the current version.";
export const TITLE_ONLY_MESSAGE = "Restoring would change only the title.";
export const TOO_LARGE_MESSAGE =
  "Too large to compare. This version can still be restored.";
export const UNDECRYPTABLE_VERSION_MESSAGE = "This version can't be decrypted.";
export const LOAD_OLDER_LABEL = "Load older versions";

/** Equal for two times on the same local day. */
export function dayKey(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today", "Yesterday", or a date such as "Mon 12 Sep", with the year when it isn't this year's. */
export function describeDay(ms: number, now: number, locale?: string): string {
  const day = dayKey(ms);
  const today = dayKey(now);
  if (day === today) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return "Yesterday";
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  })
    .format(ms)
    .replace(",", "");
}

export function describeTime(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

export function describeDateTime(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "medium",
  }).format(ms);
}

/** A session of saves, such as "14:02–14:31 · 18 saves". */
export function describeSession(
  newest: number,
  oldest: number,
  saves: number,
  locale?: string,
): string {
  const from = describeTime(oldest, locale);
  const to = describeTime(newest, locale);
  const range = from === to ? from : `${from}–${to}`;
  return `${range} · ${saves} saves`;
}

/** `previousName` is the note's name before the change, when known. */
export function describeEvent(
  event: VersionEvent,
  previousName: string | null,
): string {
  switch (event) {
    case "created":
      return "Created";
    case "renamed":
      return previousName === null
        ? "Renamed"
        : `Renamed from “${previousName}”`;
    case "moved":
      return "Moved";
    case "restoredFromTrash":
      return "Restored from trash";
    case "passphraseChanged":
      return "Passphrase changed";
    case "external":
      return "Changed outside commitnote";
  }
}

export function describeHistoryEnd(end: HistoryEnd): string {
  switch (end.kind) {
    case "created":
      return "Note created.";
    case "passphraseChanged":
      return end.historyDeleted
        ? "Earlier history was deleted when the passphrase was changed."
        : "Earlier versions are encrypted with a previous passphrase and can't be shown.";
    case "beginning":
      return "No earlier versions.";
    case "untraceable":
      return "Earlier versions couldn't be traced.";
  }
}

export function lineUnit(count: number): string {
  return count === 1 ? "line" : "lines";
}

export function describeFold(count: number): string {
  return `${count} unchanged ${lineUnit(count)}`;
}

export function describeTitleChange(current: string, version: string): string {
  return `Title: “${current}” → “${version}”`;
}

export function describeFinalNewline(change: "added" | "removed"): string {
  return change === "added"
    ? "Adds a line break at the end."
    : "Removes the line break at the end.";
}

export const RESTORE_LABEL = "Restore this version";
export const RESTORING_LABEL = "Restoring…";

export function describeRestoreTitle(name: string): string {
  return `Also restore the title “${name}”`;
}

/** Why the version can't be restored; null when the version pane already says why. */
export function describeRestoreBlock(reason: RestoreBlock): string | null {
  switch (reason) {
    case "gone":
      return "This note no longer exists.";
    case "conflicted":
      return "Resolve the conflict first.";
    case "unavailable":
      return "Changes can't be saved right now, so this version can't be restored.";
    case "undecryptable":
      return UNDECRYPTABLE_VERSION_MESSAGE;
    case "same":
      return "This version is the same as the current one.";
    case "loading":
    case "unreadable":
      return null;
  }
}

export function describeRestored(
  committedAt: number,
  now: number,
  locale?: string,
): string {
  const day = describeDay(committedAt, now, locale);
  const relative = day === "Today" || day === "Yesterday";
  return `Restored the version from ${relative ? day.toLowerCase() : day}, ${describeTime(committedAt, locale)}.`;
}
