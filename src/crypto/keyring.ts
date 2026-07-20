import {
  APP_ID,
  CIPHER_ID,
  FORMAT_VERSION,
  HKDF_INFO,
  KDF_ALGORITHM,
  KDF_DEFAULTS,
  KEY_CHECK_MESSAGE,
  NAME_SCHEME_ID,
} from "../format/v1";
import type { Argon2idFunction } from "./argon2";
import { argon2idInWorker } from "./argon2";
import { fromBase64, toBase64, utf8Encode } from "./base64";
import type { RandomSource } from "./random";
import { secureRandom } from "./random";
import type { KdfParams, RepoConfig } from "./repo-config";
import { serializeRepoConfig } from "./repo-config";

export interface Keyring {
  readonly contentKey: CryptoKey;
  readonly nameKey: CryptoKey;
  readonly nameIvKey: CryptoKey;
  readonly keyCheckKey: CryptoKey;
}

// Our Uint8Arrays are always backed by a plain ArrayBuffer, never a
// SharedArrayBuffer, but their declared type is the bare (ArrayBufferLike)
// Uint8Array, which the DOM lib's BufferSource-typed WebCrypto parameters no
// longer accept directly.
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>;
}

async function hkdfDeriveBytes(
  masterSecret: Uint8Array,
  info: string,
): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    asBufferSource(masterSecret),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: asBufferSource(utf8Encode(info)),
    },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

function zero(bytes: Uint8Array): void {
  bytes.fill(0);
}

export async function deriveKeyring(
  passphrase: string,
  kdf: KdfParams,
  argon2id: Argon2idFunction = argon2idInWorker,
): Promise<Keyring> {
  const password = utf8Encode(passphrase.normalize("NFC"));
  const masterSecret = await argon2id({
    password,
    salt: kdf.salt,
    memoryKiB: kdf.memoryKiB,
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
  });

  try {
    const contentKeyBytes = await hkdfDeriveBytes(
      masterSecret,
      HKDF_INFO.contentKey,
    );
    const nameKeyBytes = await hkdfDeriveBytes(masterSecret, HKDF_INFO.nameKey);
    const nameIvKeyBytes = await hkdfDeriveBytes(
      masterSecret,
      HKDF_INFO.nameIvKey,
    );
    const keyCheckKeyBytes = await hkdfDeriveBytes(
      masterSecret,
      HKDF_INFO.keyCheckKey,
    );

    try {
      const [contentKey, nameKey, nameIvKey, keyCheckKey] = await Promise.all([
        crypto.subtle.importKey(
          "raw",
          asBufferSource(contentKeyBytes),
          "AES-GCM",
          false,
          ["encrypt", "decrypt"],
        ),
        crypto.subtle.importKey(
          "raw",
          asBufferSource(nameKeyBytes),
          "AES-GCM",
          false,
          ["encrypt", "decrypt"],
        ),
        crypto.subtle.importKey(
          "raw",
          asBufferSource(nameIvKeyBytes),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign", "verify"],
        ),
        crypto.subtle.importKey(
          "raw",
          asBufferSource(keyCheckKeyBytes),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign", "verify"],
        ),
      ]);
      return { contentKey, nameKey, nameIvKey, keyCheckKey };
    } finally {
      zero(contentKeyBytes);
      zero(nameKeyBytes);
      zero(nameIvKeyBytes);
      zero(keyCheckKeyBytes);
    }
  } finally {
    zero(masterSecret);
  }
}

export async function computeKeyCheck(keyring: Keyring): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    keyring.keyCheckKey,
    asBufferSource(utf8Encode(KEY_CHECK_MESSAGE)),
  );
  return toBase64(new Uint8Array(signature));
}

export async function verifyKeyCheck(
  keyring: Keyring,
  config: RepoConfig,
): Promise<boolean> {
  let expected: Uint8Array;
  try {
    expected = fromBase64(config.keyCheck);
  } catch {
    return false;
  }
  return crypto.subtle.verify(
    "HMAC",
    keyring.keyCheckKey,
    asBufferSource(expected),
    asBufferSource(utf8Encode(KEY_CHECK_MESSAGE)),
  );
}

export interface CreateRepoConfigOptions {
  readonly random?: RandomSource;
  readonly now?: () => Date;
  readonly argon2id?: Argon2idFunction;
  readonly kdf?: Pick<KdfParams, "memoryKiB" | "iterations" | "parallelism">;
}

export async function createRepoConfig(
  passphrase: string,
  options: CreateRepoConfigOptions = {},
): Promise<{
  readonly config: RepoConfig;
  readonly configText: string;
  readonly keyring: Keyring;
}> {
  const random = options.random ?? secureRandom;
  const now = options.now ?? (() => new Date());
  const kdfSizing = options.kdf ?? KDF_DEFAULTS;

  const kdf: KdfParams = {
    algorithm: KDF_ALGORITHM,
    memoryKiB: kdfSizing.memoryKiB,
    iterations: kdfSizing.iterations,
    parallelism: kdfSizing.parallelism,
    salt: random(16),
  };

  const keyring = await deriveKeyring(passphrase, kdf, options.argon2id);
  const keyCheck = await computeKeyCheck(keyring);

  const config: RepoConfig = {
    formatVersion: FORMAT_VERSION,
    app: APP_ID,
    cipher: CIPHER_ID,
    nameScheme: NAME_SCHEME_ID,
    kdf,
    keyCheck,
    createdAt: now().toISOString(),
  };

  return { config, configText: serializeRepoConfig(config), keyring };
}
