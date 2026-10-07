import type { ShareEntry } from "../../share/share-index";

export function shareNoteName(entry: ShareEntry): string {
  const { note } = entry;
  return note.state === "active" ? note.path[note.path.length - 1] : entry.name;
}

export function shareRowTitle(entry: ShareEntry): {
  readonly title: string;
  readonly noteName: string | null;
} {
  const noteName = shareNoteName(entry);
  if (entry.label === null) return { title: noteName, noteName: null };
  return { title: entry.label, noteName: entry.label === noteName ? null : noteName };
}
