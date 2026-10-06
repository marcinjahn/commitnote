import { Lru } from "../history/lru";

export const NOTE_CONTENT_CACHE_SIZE = 20;

export interface NoteContentCache {
  get(blobSha: string): string | undefined;
  set(blobSha: string, content: string): void;
  delete(blobSha: string): void;
  clear(): void;
}

export function createNoteContentCache(
  capacity: number = NOTE_CONTENT_CACHE_SIZE,
): NoteContentCache {
  return new Lru<string>(capacity);
}
