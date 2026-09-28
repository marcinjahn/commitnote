import { MAX_NAME_BYTES, NAME_AAD } from "../format/v1";
import { fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from "./base64";
import type { Keyring } from "./keyring";

const IV_BYTES = 12;
const TAG_BYTES = 16;

// Our Uint8Arrays are always backed by a plain ArrayBuffer, never a
// SharedArrayBuffer, but their declared type is the bare (ArrayBufferLike)
// Uint8Array, which the DOM lib's BufferSource-typed WebCrypto parameters no
// longer accept directly.
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function deriveNameIv(
  keyring: Keyring,
  nameBytes: Uint8Array,
): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    keyring.nameIvKey,
    asBufferSource(nameBytes),
  );
  return new Uint8Array(signature).slice(0, IV_BYTES);
}

export async function encryptName(
  keyring: Keyring,
  name: string,
): Promise<string> {
  const normalized = name.normalize("NFC");
  const nameBytes = utf8Encode(normalized);
  if (nameBytes.length === 0 || nameBytes.length > MAX_NAME_BYTES) {
    throw new RangeError(
      `Name must be 1 to ${MAX_NAME_BYTES} UTF-8 bytes once NFC-normalized`,
    );
  }

  const iv = await deriveNameIv(keyring, nameBytes);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(iv),
      additionalData: asBufferSource(utf8Encode(NAME_AAD)),
    },
    keyring.nameKey,
    asBufferSource(nameBytes),
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return toBase64Url(combined);
}

export async function decryptName(
  keyring: Keyring,
  segment: string,
): Promise<string | null> {
  let combined: Uint8Array;
  try {
    combined = fromBase64Url(segment);
  } catch {
    return null;
  }

  if (combined.length < IV_BYTES + TAG_BYTES + 1) {
    return null;
  }

  const iv = combined.slice(0, IV_BYTES);
  const ciphertext = combined.slice(IV_BYTES);

  let plaintextBytes: ArrayBuffer;
  try {
    plaintextBytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(iv),
        additionalData: asBufferSource(utf8Encode(NAME_AAD)),
      },
      keyring.nameKey,
      asBufferSource(ciphertext),
    );
  } catch {
    return null;
  }

  const nameBytes = new Uint8Array(plaintextBytes);

  const expectedIv = await deriveNameIv(keyring, nameBytes);
  if (!bytesEqual(iv, expectedIv)) {
    return null;
  }

  let name: string;
  try {
    name = utf8Decode(nameBytes);
  } catch {
    return null;
  }

  if (name.normalize("NFC") !== name) {
    return null;
  }

  return name;
}

export async function encryptPath(
  keyring: Keyring,
  path: readonly string[],
): Promise<string> {
  const segments = await Promise.all(
    path.map((name) => encryptName(keyring, name)),
  );
  return segments.join("/");
}

export async function decryptPath(
  keyring: Keyring,
  storedPath: string,
): Promise<string[] | null> {
  if (storedPath === "") {
    return [];
  }

  const segments = storedPath.split("/");
  const names: string[] = [];
  for (const segment of segments) {
    const name = await decryptName(keyring, segment);
    if (name === null) {
      return null;
    }
    names.push(name);
  }
  return names;
}
