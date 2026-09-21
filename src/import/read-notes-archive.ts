import { unzipSync, type UnzipFileInfo } from "fflate";
import type { NotePath } from "../changes/change";
import { REPO_CONFIG_DIR } from "../format/v1";
import { validateName } from "../tree/note-names";

export const MAX_ARCHIVE_ENTRIES = 20_000;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

const NOTE_EXTENSION = ".md";
const RESERVED_SEGMENTS = new Set(["__MACOSX", REPO_CONFIG_DIR]);
const STORED = 0;
const DEFLATED = 8;

export type ArchiveImportEntry =
  | { readonly kind: "folder"; readonly path: NotePath }
  | {
      readonly kind: "note";
      readonly path: NotePath;
      readonly content: string;
    };

export interface ArchiveSkipCounts {
  readonly unsupported: number;
  readonly unsafePath: number;
  readonly reserved: number;
  readonly invalidName: number;
  readonly invalidEncoding: number;
}

export interface NotesArchiveContents {
  readonly entries: readonly ArchiveImportEntry[];
  readonly skipped: ArchiveSkipCounts;
}

export type NotesArchiveErrorKind =
  "invalidArchive" | "tooManyEntries" | "tooLarge";

const ERROR_MESSAGES: Record<NotesArchiveErrorKind, string> = {
  invalidArchive: "The file is not a valid zip archive",
  tooManyEntries: "The archive has too many entries",
  tooLarge: "The archive is too large when uncompressed",
};

export class NotesArchiveError extends Error {
  constructor(readonly kind: NotesArchiveErrorKind) {
    super(ERROR_MESSAGES[kind]);
    this.name = "NotesArchiveError";
  }
}

type ParsedPath =
  | { readonly kind: "skip"; readonly reason: keyof ArchiveSkipCounts }
  | { readonly kind: "folder" | "note"; readonly path: NotePath };

function parseZipPath(zipPath: string): ParsedPath {
  if (
    zipPath.includes("\\") ||
    zipPath.startsWith("/") ||
    /^[A-Za-z]:/.test(zipPath)
  ) {
    return { kind: "skip", reason: "unsafePath" };
  }
  const isFolder = zipPath.endsWith("/");
  const segments = (isFolder ? zipPath.slice(0, -1) : zipPath).split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    return { kind: "skip", reason: "unsafePath" };
  }
  if (segments.some((s) => RESERVED_SEGMENTS.has(s))) {
    return { kind: "skip", reason: "reserved" };
  }
  if (!isFolder) {
    const fileName = segments[segments.length - 1];
    if (!fileName.toLowerCase().endsWith(NOTE_EXTENSION)) {
      return { kind: "skip", reason: "unsupported" };
    }
    segments[segments.length - 1] = fileName.slice(0, -NOTE_EXTENSION.length);
  }
  const path: string[] = [];
  for (const segment of segments) {
    const validation = validateName(segment, []);
    if (!validation.ok) return { kind: "skip", reason: "invalidName" };
    path.push(validation.name);
  }
  return { kind: isFolder ? "folder" : "note", path };
}

export function readNotesArchive(bytes: Uint8Array): NotesArchiveContents {
  const skipped: Record<keyof ArchiveSkipCounts, number> = {
    unsupported: 0,
    unsafePath: 0,
    reserved: 0,
    invalidName: 0,
    invalidEncoding: 0,
  };
  const entries: ArchiveImportEntry[] = [];
  const notePaths = new Map<string, NotePath>();
  let entryCount = 0;
  let totalBytes = 0;

  function accept(file: UnzipFileInfo): boolean {
    entryCount++;
    if (entryCount > MAX_ARCHIVE_ENTRIES) {
      throw new NotesArchiveError("tooManyEntries");
    }
    const parsed = parseZipPath(file.name);
    if (parsed.kind === "skip") {
      skipped[parsed.reason]++;
      return false;
    }
    if (parsed.kind === "folder") {
      entries.push({ kind: "folder", path: parsed.path });
      return false;
    }
    if (file.compression !== STORED && file.compression !== DEFLATED) {
      skipped.unsupported++;
      return false;
    }
    totalBytes += file.originalSize;
    if (totalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new NotesArchiveError("tooLarge");
    }
    notePaths.set(file.name, parsed.path);
    return true;
  }

  let files: Record<string, Uint8Array>;
  try {
    // fflate inflates into a buffer of the declared size and never grows it,
    // so checking declared sizes in the filter bounds memory use.
    files = unzipSync(bytes, { filter: accept });
  } catch (error) {
    if (error instanceof NotesArchiveError) throw error;
    throw new NotesArchiveError("invalidArchive");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const [zipPath, path] of notePaths) {
    let content: string;
    try {
      content = decoder.decode(files[zipPath]);
    } catch {
      skipped.invalidEncoding++;
      continue;
    }
    entries.push({ kind: "note", path, content });
  }

  return { entries, skipped };
}
