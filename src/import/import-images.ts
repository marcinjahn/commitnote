import type { Keyring } from "../crypto/keyring";
import type { RandomSource } from "../crypto/random";
import {
  formatImageReference,
  imageAltText,
  parseMarkdownImages,
} from "../images/image-reference";
import {
  cloneImage,
  createPendingImage,
  type PendingImage,
} from "../images/pending-image";
import type { ProcessImage } from "../images/prepare-images";
import { resolveArchiveImagePath } from "./archive-image-paths";
import type { ArchiveImportEntry } from "./read-notes-archive";

export const MAX_IMPORT_IMAGES = 50;

export interface ImportImagesResult {
  entries: ArchiveImportEntry[];
  images: PendingImage[];
  added: number;
  failed: number;
}

export interface ImportImagesDeps {
  keyring: Keyring;
  process: () => Promise<ProcessImage>;
  random?: RandomSource;
}

type NoteEntry = Extract<ArchiveImportEntry, { kind: "note" }>;

interface Edit {
  from: number;
  to: number;
  alt: string;
  path: string;
}

export async function prepareImportImages(
  entries: readonly ArchiveImportEntry[],
  archiveImages: ReadonlyMap<string, Uint8Array>,
  deps: ImportImagesDeps,
): Promise<ImportImagesResult> {
  if (archiveImages.size === 0) {
    return { entries: [...entries], images: [], added: 0, failed: 0 };
  }

  const images: PendingImage[] = [];
  const firstByPath = new Map<string, PendingImage | null>();
  let failed = 0;
  let process: ProcessImage | undefined;

  async function obtain(
    path: string,
    bytes: Uint8Array,
  ): Promise<PendingImage | null> {
    if (images.length >= MAX_IMPORT_IMAGES) return null;
    try {
      const first = firstByPath.get(path);
      if (first) return await cloneImage(deps.keyring, first, deps.random);
      if (first === null) return null;
      process ??= await deps.process();
      const result = await process(new Blob([bytes as BlobPart]));
      if (!result.ok) {
        firstByPath.set(path, null);
        return null;
      }
      formatImageReference({
        imageId: "a".repeat(26),
        alt: "",
        width: result.payload.width,
        height: result.payload.height,
      });
      const created = await createPendingImage(
        deps.keyring,
        result.payload,
        deps.random,
      );
      firstByPath.set(path, created);
      return created;
    } catch {
      if (!firstByPath.has(path)) firstByPath.set(path, null);
      return null;
    }
  }

  async function rewriteNote(entry: NoteEntry): Promise<ArchiveImportEntry> {
    const folder = entry.archiveFolder;
    if (!folder) return entry;
    const edits: Edit[] = [];
    for (const image of parseMarkdownImages(entry.content)) {
      const path = resolveArchiveImagePath(folder, image.url);
      if (path !== null && archiveImages.has(path)) {
        edits.push({ from: image.from, to: image.to, alt: image.alt, path });
      }
    }
    if (edits.length === 0) return entry;

    const inNote = new Map<string, PendingImage | null>();
    for (const { path } of edits) {
      if (inNote.has(path)) continue;
      const pending = await obtain(path, archiveImages.get(path)!);
      inNote.set(path, pending);
      if (pending) images.push(pending);
      else failed++;
    }

    let content = entry.content;
    let changed = false;
    for (const edit of [...edits].reverse()) {
      const pending = inNote.get(edit.path);
      if (!pending) continue;
      content =
        content.slice(0, edit.from) +
        formatImageReference({
          imageId: pending.imageId,
          alt: imageAltText(edit.alt),
          width: pending.width,
          height: pending.height,
        }) +
        content.slice(edit.to);
      changed = true;
    }
    return changed ? { ...entry, content } : entry;
  }

  const result: ArchiveImportEntry[] = [];
  for (const entry of entries) {
    result.push(entry.kind === "note" ? await rewriteNote(entry) : entry);
  }
  return { entries: result, images, added: images.length, failed };
}
