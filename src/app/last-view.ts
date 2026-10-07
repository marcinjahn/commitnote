import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { decryptPath, encryptPath } from "../crypto/name-cipher";
import type { StorageLike } from "../session/session-store";

export interface LastView {
  readonly note: NotePath | null;
  readonly folders: readonly NotePath[];
}

export const LAST_VIEW_SAVE_DELAY_MS = 500;

const STORAGE_VERSION = 1;

interface StoredLastView {
  readonly version: typeof STORAGE_VERSION;
  readonly reopenLastView: true;
  readonly note: string | null;
  readonly folders: readonly string[];
}

export function lastViewStorageKey(repoKey: string): string {
  return `commitnote.lastView.${repoKey}`;
}

function resolveStorage(
  storage: StorageLike | null | undefined,
): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStored(
  storage: StorageLike | null,
  key: string,
): StoredLastView | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (value.version !== STORAGE_VERSION) return null;
    if (value.reopenLastView !== true) return null;
    const note = typeof value.note === "string" ? value.note : null;
    const folders = Array.isArray(value.folders)
      ? value.folders.filter((f): f is string => typeof f === "string")
      : [];
    return { version: STORAGE_VERSION, reopenLastView: true, note, folders };
  } catch {
    return null;
  }
}

function writeStored(
  storage: StorageLike | null,
  key: string,
  stored: Omit<StoredLastView, "version" | "reopenLastView">,
): void {
  if (!storage) return;
  try {
    const value: StoredLastView = {
      version: STORAGE_VERSION,
      reopenLastView: true,
      ...stored,
    };
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Remembering the last view is a convenience; losing it is harmless.
  }
}

function removeStored(storage: StorageLike | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

export function removeLastView(
  repoKey: string,
  storage?: StorageLike | null,
): void {
  removeStored(resolveStorage(storage), lastViewStorageKey(repoKey));
}

export interface LastViewStore {
  isEnabled(): boolean;
  setEnabled(on: boolean, view: LastView): void;
  load(): Promise<LastView | null>;
  save(view: LastView): void;
  dispose(): void;
}

async function encodePath(
  keyring: Keyring,
  path: NotePath,
): Promise<string | null> {
  if (path.length === 0) return null;
  try {
    return await encryptPath(keyring, path);
  } catch {
    return null;
  }
}

async function encodeView(
  keyring: Keyring,
  view: LastView,
): Promise<Omit<StoredLastView, "version" | "reopenLastView">> {
  const note = view.note ? await encodePath(keyring, view.note) : null;
  const folders: string[] = [];
  for (const folder of view.folders) {
    const stored = await encodePath(keyring, folder);
    if (stored !== null) folders.push(stored);
  }
  return { note, folders };
}

async function decodePath(
  keyring: Keyring,
  stored: string,
): Promise<NotePath | null> {
  try {
    const path = await decryptPath(keyring, stored);
    return path && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

export function createLastViewStore(options: {
  repoKey: string;
  keyring: Keyring;
  storage?: StorageLike | null;
  delayMs?: number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): LastViewStore {
  const { keyring } = options;
  const key = lastViewStorageKey(options.repoKey);
  const storage = resolveStorage(options.storage);
  const delayMs = options.delayMs ?? LAST_VIEW_SAVE_DELAY_MS;
  const setTimer =
    options.setTimer ?? ((run, ms) => setTimeout(run, ms) as unknown);
  const clearTimer =
    options.clearTimer ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let generation = 0;
  let timer: { handle: unknown } | null = null;
  let disposed = false;

  function cancelTimer(): void {
    if (!timer) return;
    clearTimer(timer.handle);
    timer = null;
  }

  function isEnabled(): boolean {
    return readStored(storage, key) !== null;
  }

  async function encodeAndWrite(view: LastView, ticket: number): Promise<void> {
    const encoded = await encodeView(keyring, view);
    if (disposed || ticket !== generation || !isEnabled()) return;
    writeStored(storage, key, encoded);
  }

  return {
    isEnabled,

    setEnabled(on, view) {
      cancelTimer();
      const ticket = ++generation;
      if (!on) {
        removeStored(storage, key);
        return;
      }
      if (disposed) return;
      writeStored(storage, key, { note: null, folders: [] });
      void encodeAndWrite(view, ticket);
    },

    async load() {
      const stored = readStored(storage, key);
      if (!stored) return null;
      const note = stored.note ? await decodePath(keyring, stored.note) : null;
      const folders: NotePath[] = [];
      for (const folder of stored.folders) {
        const path = await decodePath(keyring, folder);
        if (path) folders.push(path);
      }
      return { note, folders };
    },

    save(view) {
      if (disposed || !isEnabled()) return;
      cancelTimer();
      const ticket = ++generation;
      const entry = { handle: undefined as unknown };
      timer = entry;
      entry.handle = setTimer(() => {
        if (timer !== entry) return;
        timer = null;
        void encodeAndWrite(view, ticket);
      }, delayMs);
    },

    dispose() {
      disposed = true;
      generation++;
      cancelTimer();
    },
  };
}
