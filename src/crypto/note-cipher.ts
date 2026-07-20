import { NOTE_AAD, NOTE_PREFIX } from "../format/v1";
import { fromBase64, toBase64, utf8Decode, utf8Encode } from "./base64";
import type { Keyring } from "./keyring";
import type { RandomSource } from "./random";
import { secureRandom } from "./random";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export class NoteDecryptionError extends Error {}

// Our Uint8Arrays are always backed by a plain ArrayBuffer, never a
// SharedArrayBuffer, but their declared type is the bare (ArrayBufferLike)
// Uint8Array, which the DOM lib's BufferSource-typed WebCrypto parameters no
// longer accept directly.
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>;
}

export async function encryptNote(
  keyring: Keyring,
  markdown: string,
  random: RandomSource = secureRandom,
): Promise<string> {
  const iv = random(IV_BYTES);
  const plaintext = utf8Encode(markdown);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(iv),
      additionalData: asBufferSource(utf8Encode(NOTE_AAD)),
    },
    keyring.contentKey,
    asBufferSource(plaintext),
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return NOTE_PREFIX + toBase64(combined);
}

export async function decryptNote(
  keyring: Keyring,
  stored: string,
): Promise<string> {
  if (!stored.startsWith(NOTE_PREFIX)) {
    throw new NoteDecryptionError("Missing v1 note prefix");
  }

  let combined: Uint8Array;
  try {
    combined = fromBase64(stored.slice(NOTE_PREFIX.length));
  } catch {
    throw new NoteDecryptionError("Invalid base64 in stored note");
  }

  if (combined.length < IV_BYTES + TAG_BYTES) {
    throw new NoteDecryptionError("Stored note is too short");
  }

  const iv = combined.slice(0, IV_BYTES);
  const ciphertext = combined.slice(IV_BYTES);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(iv),
        additionalData: asBufferSource(utf8Encode(NOTE_AAD)),
      },
      keyring.contentKey,
      asBufferSource(ciphertext),
    );
  } catch {
    throw new NoteDecryptionError("Note ciphertext failed authentication");
  }

  try {
    return utf8Decode(new Uint8Array(plaintext));
  } catch {
    throw new NoteDecryptionError("Decrypted note is not valid UTF-8");
  }
}
