import type { NotePath } from "../changes/change";
import { decryptPath, encryptPath } from "../crypto/name-cipher";
import type { Keyring } from "../crypto/keyring";

export const NOTE_FRAGMENT_PREFIX = "#n=";

const STORED_PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

export function isNoteFragment(hash: string): boolean {
  return hash.startsWith(NOTE_FRAGMENT_PREFIX);
}

export function storedPathOfFragment(hash: string): string | null {
  if (!isNoteFragment(hash)) return null;
  const storedPath = hash.slice(NOTE_FRAGMENT_PREFIX.length);
  return STORED_PATH.test(storedPath) ? storedPath : null;
}

export function noteFragmentOf(storedPath: string): string {
  return NOTE_FRAGMENT_PREFIX + storedPath;
}

export function encodeNotePath(keyring: Keyring, path: NotePath): Promise<string> {
  if (path.length === 0) {
    return Promise.reject(new RangeError("A note path needs at least one segment"));
  }
  return encryptPath(keyring, path);
}

export async function decodeNotePath(
  keyring: Keyring,
  storedPath: string,
): Promise<NotePath | null> {
  const path = await decryptPath(keyring, storedPath);
  return path === null || path.length === 0 ? null : path;
}
