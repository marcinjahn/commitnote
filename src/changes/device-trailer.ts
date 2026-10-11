import { asBufferSource, fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from "../crypto/base64";
import type { RandomSource } from "../crypto/random";
import { secureRandom } from "../crypto/random";
import { DEVICE_AAD, TRAILER } from "../format/v1";
import { normalizeDeviceName } from "../settings/device-name";
import { parseCommitMessage } from "./commit-message";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export async function encodeDeviceTrailer(
  name: string,
  contentKey: CryptoKey,
  random: RandomSource = secureRandom,
): Promise<string> {
  const iv = random(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(iv),
      additionalData: asBufferSource(utf8Encode(DEVICE_AAD)),
    },
    contentKey,
    asBufferSource(utf8Encode(name)),
  );
  const combined = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_BYTES);
  return toBase64Url(combined);
}

export async function decodeDeviceTrailer(
  value: string,
  contentKey: CryptoKey,
): Promise<string | null> {
  try {
    const combined = fromBase64Url(value);
    if (combined.length < IV_BYTES + TAG_BYTES) return null;
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(combined.slice(0, IV_BYTES)),
        additionalData: asBufferSource(utf8Encode(DEVICE_AAD)),
      },
      contentKey,
      asBufferSource(combined.slice(IV_BYTES)),
    );
    return normalizeDeviceName(utf8Decode(new Uint8Array(plaintext)));
  } catch {
    return null;
  }
}

export async function readDeviceTrailer(
  message: string,
  contentKey: CryptoKey,
): Promise<string | null> {
  try {
    const values = parseCommitMessage(message)
      .trailers.filter((trailer) => trailer.key === TRAILER.device);
    const last = values[values.length - 1];
    return last ? await decodeDeviceTrailer(last.value, contentKey) : null;
  } catch {
    return null;
  }
}
