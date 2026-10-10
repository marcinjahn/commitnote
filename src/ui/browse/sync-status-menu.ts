import type { NotePath } from "../../changes/change";
import { syncStatusIcons } from "./action-icons";
import type { MenuItem } from "./row-menu-types";

export const UNSAVED_NOTES_SHOWN = 5;

const NOTE_ID_PREFIX = "note-";

export function describeNoteLocation(path: NotePath): string {
  const name = path[path.length - 1] ?? "";
  const folders = path.slice(0, -1);
  return folders.length === 0 ? name : `${name} — ${folders.join(" / ")}`;
}

export function buildSyncStatusMenu(input: {
  notes: readonly NotePath[];
  others: number;
  canRetry: boolean;
}): { items: MenuItem<string>[]; pathOf(id: string): NotePath | null } {
  const shown = input.notes.slice(0, UNSAVED_NOTES_SHOWN);
  const items: MenuItem<string>[] = shown.map((path, index) => ({
    id: `${NOTE_ID_PREFIX}${index}`,
    label: describeNoteLocation(path),
    icon: syncStatusIcons.note,
  }));

  const more = Math.max(0, input.notes.length - UNSAVED_NOTES_SHOWN) + input.others;
  if (more > 0) {
    const label =
      shown.length > 0
        ? `and ${more} more`
        : `${more} unsaved ${more === 1 ? "change" : "changes"}`;
    items.push({ id: "more", label, icon: [], disabled: true });
  } else if (shown.length === 0) {
    items.push({ id: "none", label: "No unsaved changes", icon: [], disabled: true });
  }

  if (input.canRetry) {
    items.push({ id: "retry", label: "Retry now", icon: syncStatusIcons.retry });
  }

  return {
    items,
    pathOf(id) {
      if (!id.startsWith(NOTE_ID_PREFIX)) return null;
      const index = Number(id.slice(NOTE_ID_PREFIX.length));
      return Number.isInteger(index) ? (shown[index] ?? null) : null;
    },
  };
}
