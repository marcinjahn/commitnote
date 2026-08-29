import { strToU8, zipSync, type Zippable } from "fflate";
import type { NotePath } from "../changes/change";
import type { WorkingFolder } from "../sync/working-tree";

type ArchiveEntry =
  | { readonly kind: "folder"; readonly zipPath: string }
  | {
      readonly kind: "note";
      readonly zipPath: string;
      readonly path: NotePath;
    };

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

export async function buildNotesArchive(
  root: WorkingFolder,
  readNote: (path: NotePath) => Promise<string>,
  mtime: Date,
): Promise<Uint8Array<ArrayBuffer>> {
  const entries = planArchive(root);
  const files: Zippable = {};
  const notes = entries.filter((entry) => entry.kind === "note");
  const contents = new Array<string>(notes.length);

  let next = 0;
  async function worker(): Promise<void> {
    while (next < notes.length) {
      const index = next++;
      contents[index] = await readNote(notes[index].path);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, notes.length) }, worker),
  );

  let noteIndex = 0;
  for (const entry of entries) {
    files[entry.zipPath] =
      entry.kind === "folder"
        ? new Uint8Array(0)
        : strToU8(contents[noteIndex++]);
  }
  return zipSync(files, { mtime });
}
