import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { decryptPath, encryptPath } from "../crypto/name-cipher";
import type { StorageLike } from "../session/session-store";
import type { NotePosition } from "../ui/note/note-position";

export const UPDATE_RESUME_KEY = "commitnote.updateResume";
export const UPDATE_RESUME_MAX_AGE_MS = 5 * 60 * 1000;

const STORAGE_VERSION = 1;

export interface UpdateResume {
  readonly folders: readonly NotePath[];
  readonly notePosition: NotePosition | null;
  readonly treeScrollTop: number | null;
}

interface StoredUpdateResume {
  readonly version: typeof STORAGE_VERSION;
  readonly repoKey: string;
  readonly savedAt: number;
  readonly folders: readonly string[];
  readonly notePosition: NotePosition | null;
  readonly treeScrollTop: number | null;
}

function offsetOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function notePositionOf(value: unknown): NotePosition | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const anchor = offsetOf(record.anchor);
  const head = offsetOf(record.head);
  const scrollTop = offsetOf(record.scrollTop);
  if (anchor === null || head === null || scrollTop === null) return null;
  return { anchor, head, scrollTop };
}

export async function saveUpdateResume(
  storage: StorageLike | null,
  options: {
    readonly keyring: Keyring;
    readonly repoKey: string;
    readonly now: number;
    readonly resume: UpdateResume;
  },
): Promise<void> {
  if (storage === null) return;
  const folders: string[] = [];
  for (const folder of options.resume.folders) {
    if (folder.length === 0) continue;
    try {
      folders.push(await encryptPath(options.keyring, folder));
    } catch {
      // A folder that cannot be encoded simply stays collapsed.
    }
  }
  const stored: StoredUpdateResume = {
    version: STORAGE_VERSION,
    repoKey: options.repoKey,
    savedAt: options.now,
    folders,
    notePosition: notePositionOf(options.resume.notePosition),
    treeScrollTop: offsetOf(options.resume.treeScrollTop),
  };
  try {
    storage.setItem(UPDATE_RESUME_KEY, JSON.stringify(stored));
  } catch {
    // Resuming the view is a convenience; the reload goes ahead without it.
  }
}

function readStored(storage: StorageLike): StoredUpdateResume | null {
  try {
    const raw = storage.getItem(UPDATE_RESUME_KEY);
    storage.removeItem(UPDATE_RESUME_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (value.version !== STORAGE_VERSION) return null;
    if (typeof value.repoKey !== "string") return null;
    if (typeof value.savedAt !== "number") return null;
    const folders = Array.isArray(value.folders)
      ? value.folders.filter((f): f is string => typeof f === "string")
      : [];
    return {
      version: STORAGE_VERSION,
      repoKey: value.repoKey,
      savedAt: value.savedAt,
      folders,
      notePosition: notePositionOf(value.notePosition),
      treeScrollTop: offsetOf(value.treeScrollTop),
    };
  } catch {
    return null;
  }
}

export async function takeUpdateResume(
  storage: StorageLike | null,
  options: { readonly keyring: Keyring; readonly repoKey: string; readonly now: number },
): Promise<UpdateResume | null> {
  if (storage === null) return null;
  const stored = readStored(storage);
  if (stored === null || stored.repoKey !== options.repoKey) return null;
  const age = options.now - stored.savedAt;
  if (age < 0 || age > UPDATE_RESUME_MAX_AGE_MS) return null;
  const folders: NotePath[] = [];
  for (const folder of stored.folders) {
    try {
      const path = await decryptPath(options.keyring, folder);
      if (path !== null && path.length > 0) folders.push(path);
    } catch {
      // Skipped like a folder that no longer exists.
    }
  }
  return {
    folders,
    notePosition: stored.notePosition,
    treeScrollTop: stored.treeScrollTop,
  };
}

export function browserSessionStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
