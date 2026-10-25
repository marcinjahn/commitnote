import { unzipSync, type UnzipFileInfo } from "fflate";
import type { NotePath } from "../changes/change";
import { REPO_CONFIG_DIR } from "../format/v1";
import { parseMarkdownImages } from "../images/image-reference";
import { validateName } from "../tree/note-names";
import {
  isArchiveImagePath,
  resolveArchiveImagePath,
} from "./archive-image-paths";

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
      readonly archiveFolder?: readonly string[];
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
  readonly images: ReadonlyMap<string, Uint8Array>;
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
  const notePaths = new Map<
    string,
    { path: NotePath; archiveFolder: readonly string[] }
  >();
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
    notePaths.set(file.name, {
      path: parsed.path,
      archiveFolder: file.name.split("/").slice(0, -1),
    });
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
  for (const [zipPath, { path, archiveFolder }] of notePaths) {
    let content: string;
    try {
      content = decoder.decode(files[zipPath]);
    } catch {
      skipped.invalidEncoding++;
      continue;
    }
    entries.push({ kind: "note", path, content, archiveFolder });
  }

  const referenced = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "note") continue;
    for (const image of parseMarkdownImages(entry.content)) {
      const resolved = resolveArchiveImagePath(
        entry.archiveFolder ?? [],
        image.url,
      );
      if (resolved !== null && isArchiveImagePath(resolved)) {
        referenced.add(resolved);
      }
    }
  }

  const images = new Map<string, Uint8Array>();
  if (referenced.size > 0) {
    const imageEntryNames = new Map<string, string>();

    function acceptImage(file: UnzipFileInfo): boolean {
      const normalized = file.name.normalize("NFC");
      if (!referenced.has(normalized)) return false;
      const parsed = parseZipPath(file.name);
      if (parsed.kind !== "skip" || parsed.reason !== "unsupported") {
        return false;
      }
      if (file.compression !== STORED && file.compression !== DEFLATED) {
        return false;
      }
      totalBytes += file.originalSize;
      if (totalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
        throw new NotesArchiveError("tooLarge");
      }
      imageEntryNames.set(file.name, normalized);
      return true;
    }

    let imageFiles: Record<string, Uint8Array>;
    try {
      imageFiles = unzipSync(bytes, { filter: acceptImage });
    } catch (error) {
      if (error instanceof NotesArchiveError) throw error;
      throw new NotesArchiveError("invalidArchive");
    }
    for (const [zipPath, normalized] of imageEntryNames) {
      images.set(normalized, imageFiles[zipPath]);
    }
    skipped.unsupported -= imageEntryNames.size;
  }

  return { entries, skipped, images };
}
