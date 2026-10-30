import { dayKey } from "../ui/history/history-messages";
import { groupVersions } from "./group-versions";
import type { NoteVersion } from "./note-history";

export type VersionRow =
  | {
      readonly kind: "single";
      readonly version: NoteVersion;
      readonly current: boolean;
    }
  | { readonly kind: "session"; readonly versions: readonly NoteVersion[] };

export interface VersionSection {
  readonly day: number;
  readonly rows: VersionRow[];
}

export function newestOfRow(row: VersionRow): NoteVersion {
  return row.kind === "single" ? row.version : row.versions[0]!;
}

/** `versions` is newest first; the newest one is the current version. */
export function buildVersionSections(
  versions: readonly NoteVersion[],
  dayOf?: (ms: number) => string,
): VersionSection[] {
  const [current, ...older] = versions;
  if (current === undefined) return [];
  const rows: VersionRow[] = [
    { kind: "single", version: current, current: true },
  ];
  for (const group of groupVersions(older, dayOf)) {
    rows.push(
      group.versions.length === 1
        ? { kind: "single", version: group.versions[0]!, current: false }
        : { kind: "session", versions: group.versions },
    );
  }
  const sections: VersionSection[] = [];
  for (const row of rows) {
    const day = dayKey(newestOfRow(row).committedAt);
    const last = sections[sections.length - 1];
    if (last !== undefined && last.day === day) last.rows.push(row);
    else sections.push({ day, rows: [row] });
  }
  return sections;
}
