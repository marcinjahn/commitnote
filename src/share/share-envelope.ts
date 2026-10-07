import type { Argon2idFunction } from "../crypto/argon2";
import {
  asBufferSource,
  fromBase64Url,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from "../crypto/base64";
import { secureRandom, type RandomSource } from "../crypto/random";
import { kdfCostOutOfBounds } from "../crypto/repo-config";
import { KDF_DEFAULTS, KDF_LIMITS } from "../format/v1";

export const SHARE_ENVELOPE_MAX_BYTES = 900_000;

const LINK_SECRET_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HKDF_INFO = "commitnote share v1 key";
const AAD_PREFIX = "commitnote share v1\n";

export interface SharedNote {
  readonly name: string;
  readonly markdown: string;
  readonly sharedAt: string;
  readonly updatedAt: string | null;
}

export type SealShareResult =
  | {
      readonly kind: "sealed";
      readonly envelope: string;
      readonly linkSecret: string;
    }
  | { readonly kind: "tooLarge" };

export type ShareOpenErrorKind = "passwordRequired" | "wrongPassword" | "damaged";

export class ShareOpenError extends Error {
  readonly kind: ShareOpenErrorKind;

  constructor(kind: ShareOpenErrorKind) {
    super(`Share cannot be opened: ${kind}`);
    this.name = "ShareOpenError";
    this.kind = kind;
  }
}

interface EnvelopeKdf {
  readonly alg: "argon2id";
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
}

interface ParsedEnvelope {
  readonly kdf: EnvelopeKdf | null;
  readonly salt: string;
  readonly saltBytes: Uint8Array;
  readonly iv: Uint8Array;
  readonly ct: Uint8Array;
}

function canonicalKdf(kdf: EnvelopeKdf | null): EnvelopeKdf | null {
  return kdf === null
    ? null
    : {
        alg: "argon2id",
        memoryKiB: kdf.memoryKiB,
        iterations: kdf.iterations,
        parallelism: kdf.parallelism,
      };
}

function buildAad(kdf: EnvelopeKdf | null, salt: string): Uint8Array {
  const headerJson = JSON.stringify({ v: 1, kdf: canonicalKdf(kdf), salt });
  return utf8Encode(AAD_PREFIX + headerJson);
}

async function deriveShareKey(
  linkSecret: Uint8Array,
  salt: Uint8Array,
  kdf: EnvelopeKdf | null,
  password: string | undefined,
  argon2id: Argon2idFunction,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  let ikmBytes = linkSecret;
  let passwordKey: Uint8Array | null = null;
  if (kdf !== null) {
    const passwordBytes = utf8Encode((password ?? "").normalize("NFC"));
    try {
      passwordKey = await argon2id({
        password: passwordBytes,
        salt,
        memoryKiB: kdf.memoryKiB,
        iterations: kdf.iterations,
        parallelism: kdf.parallelism,
      });
    } finally {
      passwordBytes.fill(0);
    }
    ikmBytes = new Uint8Array(linkSecret.length + passwordKey.length);
    ikmBytes.set(linkSecret, 0);
    ikmBytes.set(passwordKey, linkSecret.length);
  }

  let keyBytes: Uint8Array | null = null;
  try {
    const ikm = await crypto.subtle.importKey(
      "raw",
      asBufferSource(ikmBytes),
      "HKDF",
      false,
      ["deriveBits"],
    );
    keyBytes = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: asBufferSource(salt),
          info: asBufferSource(utf8Encode(HKDF_INFO)),
        },
        ikm,
        256,
      ),
    );
    return await crypto.subtle.importKey(
      "raw",
      asBufferSource(keyBytes),
      "AES-GCM",
      false,
      [usage],
    );
  } finally {
    keyBytes?.fill(0);
    passwordKey?.fill(0);
    if (ikmBytes !== linkSecret) {
      ikmBytes.fill(0);
    }
  }
}

export async function sealShare(
  input: SharedNote & {
    readonly password?: string;
    readonly linkSecret?: string;
    readonly random?: RandomSource;
    readonly argon2id: Argon2idFunction;
  },
): Promise<SealShareResult> {
  const random = input.random ?? secureRandom;
  const linkSecret =
    input.linkSecret === undefined
      ? random(LINK_SECRET_BYTES)
      : decodeExact(input.linkSecret, LINK_SECRET_BYTES);
  const salt = random(KDF_LIMITS.saltBytes);
  const iv = random(IV_BYTES);

  const kdf: EnvelopeKdf | null = input.password
    ? {
        alg: "argon2id",
        memoryKiB: KDF_DEFAULTS.memoryKiB,
        iterations: KDF_DEFAULTS.iterations,
        parallelism: KDF_DEFAULTS.parallelism,
      }
    : null;
  const saltText = toBase64Url(salt);
  const plaintext = utf8Encode(
    JSON.stringify({
      v: 1,
      name: input.name,
      markdown: input.markdown,
      sharedAt: input.sharedAt,
      updatedAt: input.updatedAt,
    }),
  );

  try {
    const key = await deriveShareKey(
      linkSecret,
      salt,
      kdf,
      input.password,
      input.argon2id,
      "encrypt",
    );
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: asBufferSource(iv),
          additionalData: asBufferSource(buildAad(kdf, saltText)),
        },
        key,
        asBufferSource(plaintext),
      ),
    );
    const envelope = JSON.stringify({
      commitnote: "share",
      v: 1,
      kdf,
      salt: saltText,
      iv: toBase64Url(iv),
      ct: toBase64Url(ct),
    });
    if (utf8Encode(envelope).length > SHARE_ENVELOPE_MAX_BYTES) {
      return { kind: "tooLarge" };
    }
    return { kind: "sealed", envelope, linkSecret: toBase64Url(linkSecret) };
  } finally {
    plaintext.fill(0);
    linkSecret.fill(0);
  }
}

function decodeExact(text: unknown, length: number): Uint8Array {
  if (typeof text !== "string") {
    throw new ShareOpenError("damaged");
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(text);
  } catch {
    throw new ShareOpenError("damaged");
  }
  if (bytes.length !== length) {
    throw new ShareOpenError("damaged");
  }
  return bytes;
}

function parseEnvelope(envelope: string): ParsedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new ShareOpenError("damaged");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ShareOpenError("damaged");
  }
  const record = parsed as Record<string, unknown>;
  if (record.commitnote !== "share" || record.v !== 1) {
    throw new ShareOpenError("damaged");
  }

  let kdf: EnvelopeKdf | null = null;
  if (record.kdf !== null) {
    const raw = record.kdf;
    if (typeof raw !== "object" || Array.isArray(raw) || raw === undefined) {
      throw new ShareOpenError("damaged");
    }
    const candidate = raw as Record<string, unknown>;
    if (
      candidate.alg !== "argon2id" ||
      kdfCostOutOfBounds(candidate) !== null
    ) {
      throw new ShareOpenError("damaged");
    }
    kdf = {
      alg: "argon2id",
      memoryKiB: candidate.memoryKiB as number,
      iterations: candidate.iterations as number,
      parallelism: candidate.parallelism as number,
    };
  }

  const saltBytes = decodeExact(record.salt, KDF_LIMITS.saltBytes);
  const iv = decodeExact(record.iv, IV_BYTES);
  if (typeof record.ct !== "string") {
    throw new ShareOpenError("damaged");
  }
  let ct: Uint8Array;
  try {
    ct = fromBase64Url(record.ct);
  } catch {
    throw new ShareOpenError("damaged");
  }
  if (ct.length < TAG_BYTES) {
    throw new ShareOpenError("damaged");
  }
  return { kdf, salt: record.salt as string, saltBytes, iv, ct };
}

export function envelopeNeedsPassword(envelope: string): boolean {
  return parseEnvelope(envelope).kdf !== null;
}

function parseSharedNote(plaintext: Uint8Array): SharedNote {
  let value: unknown;
  try {
    value = JSON.parse(utf8Decode(plaintext));
  } catch {
    throw new ShareOpenError("damaged");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ShareOpenError("damaged");
  }
  const record = value as Record<string, unknown>;
  if (
    record.v !== 1 ||
    typeof record.name !== "string" ||
    typeof record.markdown !== "string" ||
    typeof record.sharedAt !== "string"
  ) {
    throw new ShareOpenError("damaged");
  }
  return {
    name: record.name,
    markdown: record.markdown,
    sharedAt: record.sharedAt,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

export async function openShare(
  envelope: string,
  linkSecret: string,
  password: string | undefined,
  argon2id: Argon2idFunction,
): Promise<SharedNote> {
  const parsed = parseEnvelope(envelope);
  const secretBytes = decodeExact(linkSecret, LINK_SECRET_BYTES);
  const usedPassword = parsed.kdf !== null;
  if (usedPassword && !password) {
    throw new ShareOpenError("passwordRequired");
  }

  let plaintext: Uint8Array;
  try {
    const key = await deriveShareKey(
      secretBytes,
      parsed.saltBytes,
      parsed.kdf,
      password,
      argon2id,
      "decrypt",
    );
    try {
      plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: asBufferSource(parsed.iv),
            additionalData: asBufferSource(buildAad(parsed.kdf, parsed.salt)),
          },
          key,
          asBufferSource(parsed.ct),
        ),
      );
    } catch {
      throw new ShareOpenError(usedPassword ? "wrongPassword" : "damaged");
    }
  } finally {
    secretBytes.fill(0);
  }

  try {
    return parseSharedNote(plaintext);
  } finally {
    plaintext.fill(0);
  }
}
