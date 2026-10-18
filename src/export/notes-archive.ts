import { strToU8, zipSync, type Zippable } from "fflate";
import type { NotePath } from "../changes/change";
import { imageFileExtension } from "../images/image-file-extension";
import { parseImageReferences } from "../images/image-reference";
import type { ReadImagePayload } from "../images/image-resolver";
import type { WorkingFolder } from "../sync/working-tree";

type ArchiveEntry =
  | { readonly kind: "folder"; readonly zipPath: string }
  | {
      readonly kind: "note";
      readonly zipPath: string;
      readonly path: NotePath;
    };

export const EXPORT_IMAGES_DIR = "_images";
const NOTE_EXTENSION = ".md";
const READ_CONCURRENCY = 6;

function safeSegment(name: string): string {
  const replaced = name.replace(/[/\\]/g, "_");
  if (replaced.trim() === "" || replaced === "." || replaced === "..") {
    return "_";
  }
  return replaced;
}

function splitExtension(fileName: string): [string, string] {
  return fileName.toLowerCase().endsWith(NOTE_EXTENSION)
    ? [
        fileName.slice(0, -NOTE_EXTENSION.length),
        fileName.slice(-NOTE_EXTENSION.length),
      ]
    : [fileName, ""];
}

function noteFileName(name: string): string {
  const safe = safeSegment(name);
  return splitExtension(safe)[1] === "" ? `${safe}${NOTE_EXTENSION}` : safe;
}

function uniqueName(
  candidate: string,
  taken: Set<string>,
  isNote: boolean,
): string {
  const [stem, extension] = isNote
    ? splitExtension(candidate)
    : [candidate, ""];
  // Case-insensitive, so the archive also extracts cleanly on macOS and Windows.
  let result = candidate;
  for (let n = 2; taken.has(result.toLowerCase()); n++) {
    result = `${stem} (${n})${extension}`;
  }
  taken.add(result.toLowerCase());
  return result;
}

function planArchive(root: WorkingFolder): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  function walk(folder: WorkingFolder, prefix: string): void {
    const taken = new Set<string>();
    for (const child of folder.children) {
      if (child.kind === "folder") {
        const name = uniqueName(safeSegment(child.name), taken, false);
        const zipPath = `${prefix}${name}/`;
        entries.push({ kind: "folder", zipPath });
        walk(child, zipPath);
      } else {
        const name = uniqueName(noteFileName(child.name), taken, true);
        entries.push({
          kind: "note",
          zipPath: `${prefix}${name}`,
          path: child.path,
        });
      }
    }
  }
  walk(root, "");
  return entries;
}

interface ExportedNote {
  text: string;
  images: Map<string, Uint8Array>;
}

async function exportNote(
  zipPath: string,
  text: string,
  readImage: ReadImagePayload | undefined,
): Promise<ExportedNote> {
  const images = new Map<string, Uint8Array>();
  const references = readImage ? parseImageReferences(text) : [];
  if (!readImage || references.length === 0) {
    return { text, images };
  }
  const folder = zipPath.slice(0, zipPath.lastIndexOf("/") + 1);
  const relativePaths = new Map<string, string | null>();
  for (const { imageId } of references) {
    if (relativePaths.has(imageId)) {
      continue;
    }
    const payload = await readImage(imageId);
    if (payload === null) {
      relativePaths.set(imageId, null);
      continue;
    }
    const relativePath = `${EXPORT_IMAGES_DIR}/${imageId}.${imageFileExtension(payload.type)}`;
    relativePaths.set(imageId, relativePath);
    images.set(`${folder}${relativePath}`, payload.bytes);
  }
  let rewritten = text;
  for (const reference of [...references].reverse()) {
    const relativePath = relativePaths.get(reference.imageId);
    if (relativePath) {
      rewritten =
        rewritten.slice(0, reference.from) +
        `![${reference.alt}](${relativePath})` +
        rewritten.slice(reference.to);
    }
  }
  return { text: rewritten, images };
}

export async function buildNotesArchive(
  root: WorkingFolder,
  readNote: (path: NotePath) => Promise<string>,
  mtime: Date,
  readImage?: ReadImagePayload,
): Promise<Uint8Array<ArrayBuffer>> {
  const entries = planArchive(root);
  const files: Zippable = {};
  const notes = entries.filter((entry) => entry.kind === "note");
  const exported = new Array<ExportedNote>(notes.length);

  let next = 0;
  async function worker(): Promise<void> {
    while (next < notes.length) {
      const index = next++;
      const text = await readNote(notes[index].path);
      exported[index] = await exportNote(
        notes[index].zipPath,
        text,
        readImage,
      );
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, notes.length) }, worker),
  );

  let noteIndex = 0;
  for (const entry of entries) {
    if (entry.kind === "folder") {
      files[entry.zipPath] = new Uint8Array(0);
      continue;
    }
    const { text, images } = exported[noteIndex++];
    files[entry.zipPath] = strToU8(text);
    for (const [path, bytes] of images) {
      files[path] = [bytes, { level: 0 }];
    }
  }
  return zipSync(files, { mtime });
}
