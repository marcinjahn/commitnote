import { validateName } from "../tree/note-names";
import type { ArchiveImportEntry } from "./read-notes-archive";

export const MAX_DROPPED_FILES = 100;
export const MAX_DROPPED_FILE_BYTES = 1024 * 1024;
export const DROPPED_NOTE_EXTENSIONS = [".md", ".markdown", ".txt"] as const;

export interface DroppedFile {
  readonly name: string;
  readonly size: number;
  readonly directory: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface DropSkipCounts {
  readonly folders: number;
  readonly unsupported: number;
  readonly invalidEncoding: number;
  readonly invalidName: number;
  readonly tooLarge: number;
  readonly tooMany: number;
}

export interface DroppedNotes {
  readonly entries: readonly Extract<ArchiveImportEntry, { kind: "note" }>[];
  readonly skipped: DropSkipCounts;
}

export function countDropSkipped(skipped: DropSkipCounts): number {
  return (
    skipped.folders +
    skipped.unsupported +
    skipped.invalidEncoding +
    skipped.invalidName +
    skipped.tooLarge +
    skipped.tooMany
  );
}

function noteExtension(name: string): string | undefined {
  const lower = name.toLowerCase();
  return DROPPED_NOTE_EXTENSIONS.find((extension) => lower.endsWith(extension));
}

export async function readDroppedFiles(
  files: readonly DroppedFile[],
): Promise<DroppedNotes> {
  const skipped: { -readonly [K in keyof DropSkipCounts]: number } = {
    folders: 0,
    unsupported: 0,
    invalidEncoding: 0,
    invalidName: 0,
    tooLarge: 0,
    tooMany: 0,
  };
  const entries: Extract<ArchiveImportEntry, { kind: "note" }>[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let considered = 0;

  for (const file of files) {
    if (file.directory) {
      skipped.folders++;
      continue;
    }
    if (considered >= MAX_DROPPED_FILES) {
      skipped.tooMany++;
      continue;
    }
    considered++;
    const extension = noteExtension(file.name);
    if (extension === undefined) {
      skipped.unsupported++;
      continue;
    }
    if (file.size > MAX_DROPPED_FILE_BYTES) {
      skipped.tooLarge++;
      continue;
    }
    let content: string;
    try {
      content = decoder.decode(await file.arrayBuffer());
    } catch {
      skipped.invalidEncoding++;
      continue;
    }
    const validation = validateName(file.name.slice(0, -extension.length), []);
    if (!validation.ok) {
      skipped.invalidName++;
      continue;
    }
    entries.push({ kind: "note", path: [validation.name], content });
  }

  return { entries, skipped };
}
