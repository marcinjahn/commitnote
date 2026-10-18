import { IMAGE_AAD_PREFIX, IMAGE_ENVELOPE_MAGIC } from "../format/v1";
import type { ImageId } from "../images/image-id";
import { asBufferSource, utf8Decode, utf8Encode } from "./base64";
import type { Keyring } from "./keyring";
import { padmeLength } from "./padme";
import { type RandomSource, secureRandom } from "./random";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const LENGTH_PREFIX_BYTES = 4;
const MIN_ENVELOPE_BYTES = IMAGE_ENVELOPE_MAGIC.length + IV_BYTES + TAG_BYTES;

export type ImageType = "image/webp" | "image/gif";

export interface ImagePayload {
  type: ImageType;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export type ImageDecryptionErrorKind = "short" | "magic" | "auth" | "header";

const MESSAGES: Record<ImageDecryptionErrorKind, string> = {
  short: "Image envelope is too short",
  magic: "Image envelope has an unknown format",
  auth: "Image envelope failed authentication",
  header: "Image envelope header is invalid",
};

export class ImageDecryptionError extends Error {
  readonly kind: ImageDecryptionErrorKind;

  constructor(kind: ImageDecryptionErrorKind) {
    super(MESSAGES[kind]);
    this.name = "ImageDecryptionError";
    this.kind = kind;
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function additionalData(imageId: ImageId): BufferSource {
  return asBufferSource(utf8Encode(IMAGE_AAD_PREFIX + imageId));
}

export async function encryptImage(
  keyring: Keyring,
  imageId: ImageId,
  payload: ImagePayload,
  random: RandomSource = secureRandom,
): Promise<Uint8Array> {
  if (!isPositiveInteger(payload.width) || !isPositiveInteger(payload.height)) {
    throw new Error("Image dimensions must be positive integers");
  }
  const header = utf8Encode(
    JSON.stringify({
      v: 1,
      type: payload.type,
      width: payload.width,
      height: payload.height,
      length: payload.bytes.length,
    }),
  );
  const contentLength =
    LENGTH_PREFIX_BYTES + header.length + payload.bytes.length;
  const plaintext = new Uint8Array(padmeLength(contentLength));
  new DataView(plaintext.buffer).setUint32(0, header.length, false);
  plaintext.set(header, LENGTH_PREFIX_BYTES);
  plaintext.set(payload.bytes, LENGTH_PREFIX_BYTES + header.length);

  const iv = random(IV_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(iv),
        additionalData: additionalData(imageId),
      },
      keyring.contentKey,
      asBufferSource(plaintext),
    ),
  );

  const envelope = new Uint8Array(
    IMAGE_ENVELOPE_MAGIC.length + IV_BYTES + ciphertext.length,
  );
  envelope.set(IMAGE_ENVELOPE_MAGIC, 0);
  envelope.set(iv, IMAGE_ENVELOPE_MAGIC.length);
  envelope.set(ciphertext, IMAGE_ENVELOPE_MAGIC.length + IV_BYTES);
  return envelope;
}

function parseHeader(plaintext: Uint8Array): ImagePayload {
  if (plaintext.length < LENGTH_PREFIX_BYTES) {
    throw new ImageDecryptionError("header");
  }
  const headerLength = new DataView(
    plaintext.buffer,
    plaintext.byteOffset,
    plaintext.byteLength,
  ).getUint32(0, false);
  const bytesStart = LENGTH_PREFIX_BYTES + headerLength;
  if (headerLength === 0 || bytesStart > plaintext.length) {
    throw new ImageDecryptionError("header");
  }

  let header: unknown;
  try {
    header = JSON.parse(
      utf8Decode(plaintext.subarray(LENGTH_PREFIX_BYTES, bytesStart)),
    );
  } catch {
    throw new ImageDecryptionError("header");
  }
  if (typeof header !== "object" || header === null) {
    throw new ImageDecryptionError("header");
  }
  const { v, type, width, height, length } = header as Record<string, unknown>;
  if (
    v !== 1 ||
    (type !== "image/webp" && type !== "image/gif") ||
    !isPositiveInteger(width) ||
    !isPositiveInteger(height) ||
    typeof length !== "number" ||
    !Number.isInteger(length) ||
    length < 0 ||
    bytesStart + length > plaintext.length
  ) {
    throw new ImageDecryptionError("header");
  }
  return {
    type,
    width,
    height,
    bytes: plaintext.slice(bytesStart, bytesStart + length),
  };
}

export async function decryptImage(
  keyring: Keyring,
  imageId: ImageId,
  envelope: Uint8Array,
): Promise<ImagePayload> {
  if (envelope.length < MIN_ENVELOPE_BYTES) {
    throw new ImageDecryptionError("short");
  }
  const magicEnd = IMAGE_ENVELOPE_MAGIC.length;
  for (let i = 0; i < magicEnd; i += 1) {
    if (envelope[i] !== IMAGE_ENVELOPE_MAGIC[i]) {
      throw new ImageDecryptionError("magic");
    }
  }

  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: asBufferSource(envelope.slice(magicEnd, magicEnd + IV_BYTES)),
          additionalData: additionalData(imageId),
        },
        keyring.contentKey,
        asBufferSource(envelope.slice(magicEnd + IV_BYTES)),
      ),
    );
  } catch {
    throw new ImageDecryptionError("auth");
  }
  return parseHeader(plaintext);
}
