import {
  APP_ID,
  CIPHER_ID,
  FORMAT_VERSION,
  KDF_ALGORITHM,
  KDF_LIMITS,
  NAME_SCHEME_ID,
  REPO_CONFIG_PATH,
} from "../format/v1";
import type { TreeEntry } from "../forge/forge-adapter";
import { fromBase64, toBase64 } from "./base64";

export interface KdfParams {
  readonly algorithm: "argon2id";
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
  readonly salt: Uint8Array;
}

export interface RepoConfig {
  readonly formatVersion: 1;
  readonly app: "commitnote";
  readonly cipher: "AES-256-GCM";
  readonly nameScheme: "AES-256-GCM-SIV-HMAC-SHA256/base64url";
  readonly kdf: KdfParams;
  readonly keyCheck: string;
  readonly createdAt: string;
  readonly settings?: unknown;
}

export type RepoConfigParseResult =
  | { readonly kind: "valid"; readonly config: RepoConfig }
  | { readonly kind: "newerFormat"; readonly formatVersion: number }
  | { readonly kind: "invalid"; readonly reason: string };

const TOP_LEVEL_KEYS = [
  "formatVersion",
  "app",
  "cipher",
  "nameScheme",
  "kdf",
  "keyCheck",
  "createdAt",
] as const;

const KDF_KEYS = [
  "algorithm",
  "memoryKiB",
  "iterations",
  "parallelism",
  "salt",
] as const;

const KEY_CHECK_BYTES = 32;

export function findConfigEntry(
  listing: readonly TreeEntry[],
): TreeEntry | undefined {
  return listing.find(
    (entry) => entry.type === "blob" && entry.path === REPO_CONFIG_PATH,
  );
}

function invalid(reason: string): RepoConfigParseResult {
  return { kind: "invalid", reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parseRepoConfig(text: string): RepoConfigParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid("not valid JSON");
  }

  if (!isPlainObject(parsed)) {
    return invalid("top-level value is not an object");
  }

  if (parsed.app !== APP_ID) {
    return invalid("app is not commitnote");
  }

  if (!isPositiveSafeInteger(parsed.formatVersion)) {
    return invalid("formatVersion is not a positive integer");
  }

  if (parsed.formatVersion > FORMAT_VERSION) {
    return { kind: "newerFormat", formatVersion: parsed.formatVersion };
  }

  const hasSettings = Object.prototype.hasOwnProperty.call(parsed, "settings");
  if (
    !hasExactKeys(
      parsed,
      hasSettings ? [...TOP_LEVEL_KEYS, "settings"] : TOP_LEVEL_KEYS,
    )
  ) {
    return invalid("unexpected or missing top-level keys");
  }

  if (parsed.cipher !== CIPHER_ID) {
    return invalid("cipher is not the recognized identifier");
  }

  if (parsed.nameScheme !== NAME_SCHEME_ID) {
    return invalid("nameScheme is not the recognized identifier");
  }

  const kdf = parsed.kdf;
  if (!isPlainObject(kdf)) {
    return invalid("kdf is not an object");
  }
  if (!hasExactKeys(kdf, KDF_KEYS)) {
    return invalid("unexpected or missing kdf keys");
  }
  if (kdf.algorithm !== KDF_ALGORITHM) {
    return invalid("kdf.algorithm is not the recognized identifier");
  }
  if (
    !Number.isInteger(kdf.memoryKiB) ||
    (kdf.memoryKiB as number) < KDF_LIMITS.minMemoryKiB ||
    (kdf.memoryKiB as number) > KDF_LIMITS.maxMemoryKiB
  ) {
    return invalid("kdf.memoryKiB is out of bounds");
  }
  const memoryKiB = kdf.memoryKiB as number;
  if (
    !Number.isInteger(kdf.iterations) ||
    (kdf.iterations as number) < KDF_LIMITS.minIterations ||
    (kdf.iterations as number) > KDF_LIMITS.maxIterations
  ) {
    return invalid("kdf.iterations is out of bounds");
  }
  const maxParallelism = Math.floor(memoryKiB / 8);
  if (
    !Number.isInteger(kdf.parallelism) ||
    (kdf.parallelism as number) < KDF_LIMITS.minParallelism ||
    (kdf.parallelism as number) > maxParallelism
  ) {
    return invalid("kdf.parallelism is out of bounds");
  }
  if (typeof kdf.salt !== "string") {
    return invalid("kdf.salt is not a string");
  }
  let salt: Uint8Array;
  try {
    salt = fromBase64(kdf.salt);
  } catch {
    return invalid("kdf.salt is not valid base64");
  }
  if (salt.length !== KDF_LIMITS.saltBytes) {
    return invalid("kdf.salt is not 16 bytes");
  }

  if (typeof parsed.keyCheck !== "string") {
    return invalid("keyCheck is not a string");
  }
  let keyCheckBytes: Uint8Array;
  try {
    keyCheckBytes = fromBase64(parsed.keyCheck);
  } catch {
    return invalid("keyCheck is not valid base64");
  }
  if (keyCheckBytes.length !== KEY_CHECK_BYTES) {
    return invalid("keyCheck is not 32 bytes");
  }

  if (
    typeof parsed.createdAt !== "string" ||
    Number.isNaN(Date.parse(parsed.createdAt))
  ) {
    return invalid("createdAt is not a parseable timestamp");
  }

  const config: RepoConfig = {
    formatVersion: FORMAT_VERSION,
    app: APP_ID,
    cipher: CIPHER_ID,
    nameScheme: NAME_SCHEME_ID,
    kdf: {
      algorithm: KDF_ALGORITHM,
      memoryKiB,
      iterations: kdf.iterations as number,
      parallelism: kdf.parallelism as number,
      salt,
    },
    keyCheck: parsed.keyCheck,
    createdAt: parsed.createdAt,
    ...(hasSettings ? { settings: parsed.settings } : {}),
  };
  return { kind: "valid", config };
}

export function serializeRepoConfig(config: RepoConfig): string {
  const ordered = {
    formatVersion: config.formatVersion,
    app: config.app,
    cipher: config.cipher,
    nameScheme: config.nameScheme,
    kdf: {
      algorithm: config.kdf.algorithm,
      memoryKiB: config.kdf.memoryKiB,
      iterations: config.kdf.iterations,
      parallelism: config.kdf.parallelism,
      salt: toBase64(config.kdf.salt),
    },
    keyCheck: config.keyCheck,
    createdAt: config.createdAt,
    ...(config.settings !== undefined ? { settings: config.settings } : {}),
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}
