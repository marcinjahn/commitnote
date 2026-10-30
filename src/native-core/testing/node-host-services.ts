/// <reference types="node" />
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { argon2idDirect } from "../../crypto/argon2";
import {
  readImageDimensions,
  sniffImageFormat,
} from "../../images/pipeline/image-format";
import type {
  HostBlobCacheEntry,
  HostClock,
  HostCrypto,
  HostImageCodec,
  HostImageInput,
  HostKeyAlgorithm,
  HostLogLevel,
  HostServices,
  KeyHandle,
  RememberedSessionRecord,
} from "../host-services";

export interface NodeHostServices extends HostServices {
  readonly posted: string[];
  readonly logs: { level: HostLogLevel; message: string }[];
  stageInput(bytes: Uint8Array, type: string): string;
}

interface StoredKey {
  readonly raw: Uint8Array;
  readonly algorithm: HostKeyAlgorithm;
}

function plain(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(source.length);
  copy.set(source);
  return copy;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const AES_KEY_BYTES = new Set([16, 24, 32]);
const TAG_BYTES = 16;

function createNodeCrypto(keys: Map<KeyHandle, StoredKey>): HostCrypto {
  function keyOf(handle: KeyHandle, algorithm: HostKeyAlgorithm): Uint8Array {
    const key = keys.get(handle);
    if (key === undefined || key.algorithm !== algorithm) {
      throw new Error(`Unknown ${algorithm} key handle`);
    }
    return key.raw;
  }

  function aesCipher(
    raw: Uint8Array,
  ): "aes-128-gcm" | "aes-192-gcm" | "aes-256-gcm" {
    return `aes-${raw.length * 8}-gcm` as
      "aes-128-gcm" | "aes-192-gcm" | "aes-256-gcm";
  }

  return {
    importKey(raw, algorithm) {
      if (algorithm === "AES-GCM" && !AES_KEY_BYTES.has(raw.length)) {
        throw new Error("AES key must be 128, 192 or 256 bits");
      }
      const handle = randomUUID();
      keys.set(handle, { raw: plain(raw), algorithm });
      return handle;
    },
    aesGcmEncrypt(key, iv, additionalData, plaintext) {
      const raw = keyOf(key, "AES-GCM");
      const cipher = createCipheriv(aesCipher(raw), raw, iv, {
        authTagLength: TAG_BYTES,
      });
      cipher.setAAD(additionalData);
      return concat(
        cipher.update(plaintext),
        cipher.final(),
        cipher.getAuthTag(),
      );
    },
    aesGcmDecrypt(key, iv, additionalData, sealed) {
      const raw = keyOf(key, "AES-GCM");
      if (sealed.length < TAG_BYTES) {
        return null;
      }
      const decipher = createDecipheriv(aesCipher(raw), raw, iv, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(additionalData);
      decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
      try {
        return concat(
          decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
          decipher.final(),
        );
      } catch {
        return null;
      }
    },
    hkdfSha256(key, salt, info, lengthBytes) {
      return plain(
        hkdfSync("sha256", keyOf(key, "HKDF"), salt, info, lengthBytes),
      );
    },
    hmacSha256(key, data) {
      return plain(
        createHmac("sha256", keyOf(key, "HMAC-SHA-256")).update(data).digest(),
      );
    },
    digest(algorithm, data) {
      return plain(
        createHash(algorithm === "SHA-1" ? "sha1" : "sha256")
          .update(data)
          .digest(),
      );
    },
    async argon2id(input) {
      if (input.hashLength !== 32) {
        throw new Error("Only 32-byte Argon2id hashes are supported");
      }
      return plain(await argon2idDirect(input));
    },
  };
}

const MAX_VP8_DIMENSION = 0x3fff;
const MIN_WEBP_BYTES = 64;

function fakeLossyWebp(width: number, height: number, quality: number): Uint8Array {
  const length = Math.max(
    MIN_WEBP_BYTES,
    Math.round((width * height * quality) / 8),
  );
  const out = new Uint8Array(length);
  const data = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  data.setUint32(4, length - 8, true);
  ascii(8, "WEBP");
  ascii(12, "VP8 ");
  data.setUint32(16, length - 20, true);
  out[20] = 0x10;
  out.set([0x9d, 0x01, 0x2a], 23);
  data.setUint16(26, width, true);
  data.setUint16(28, height, true);
  return out;
}

function createNodeImageCodec(
  inputs: Map<string, HostImageInput>,
): HostImageCodec {
  const images = new Map<string, { width: number; height: number }>();
  return {
    takeInput(input) {
      const staged = inputs.get(input);
      if (staged === undefined) return null;
      inputs.delete(input);
      return staged;
    },
    async decode(bytes) {
      const format = sniffImageFormat(bytes);
      const dimensions =
        format === null ? null : readImageDimensions(bytes, format);
      if (dimensions === null) {
        throw new Error("Not a decodable image");
      }
      const handle = randomUUID();
      images.set(handle, {
        width: dimensions.width,
        height: dimensions.height,
      });
      return { handle, width: dimensions.width, height: dimensions.height };
    },
    async encodeWebp(handle, width, height, quality) {
      if (!images.has(handle)) {
        throw new Error("Unknown image handle");
      }
      const valid = (value: number) =>
        Number.isInteger(value) && value > 0 && value <= MAX_VP8_DIMENSION;
      if (!valid(width) || !valid(height)) {
        throw new Error("WebP dimensions out of range");
      }
      return fakeLossyWebp(width, height, quality);
    },
    release(handle) {
      images.delete(handle);
    },
  };
}

function realClock(): HostClock {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextId = 1;
  return {
    now: () => Date.now(),
    setTimeout(callback, ms) {
      const id = nextId++;
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          callback();
        }, ms),
      );
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(id);
      }
    },
  };
}

function copyEntry(entry: HostBlobCacheEntry): HostBlobCacheEntry {
  return {
    bytes: plain(entry.bytes),
    text: entry.text,
    lastUsedAt: entry.lastUsedAt,
  };
}

interface StoredSession {
  readonly repoUrl: string;
  readonly coordinates: RememberedSessionRecord["coordinates"];
  readonly accessToken: string;
  readonly keys: Record<keyof RememberedSessionRecord["keys"], StoredKey>;
}

export function createNodeHostServices(
  options: { clock?: HostClock; fetch?: typeof fetch } = {},
): NodeHostServices {
  const keys = new Map<KeyHandle, StoredKey>();
  const crypto = createNodeCrypto(keys);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const posted: string[] = [];
  const logs: { level: HostLogLevel; message: string }[] = [];
  const blobs = new Map<string, Map<string, HostBlobCacheEntry>>();
  const settings = new Map<string, string>();
  let session: StoredSession | null = null;
  const imageInputs = new Map<string, HostImageInput>();

  function storedKey(handle: KeyHandle): StoredKey {
    const key = keys.get(handle);
    if (key === undefined) {
      throw new Error("Unknown key handle");
    }
    return { raw: plain(key.raw), algorithm: key.algorithm };
  }

  return {
    posted,
    logs,
    stageInput(bytes, type) {
      const input = randomUUID();
      imageInputs.set(input, { bytes: plain(bytes), type });
      return input;
    },
    crypto,
    random: {
      randomBytes: (length) => plain(randomBytes(length)),
    },
    http: {
      async request(request) {
        const response = await fetchImpl(request.url, {
          method: request.method,
          headers: request.headers,
          body:
            request.body === null
              ? undefined
              : (plain(request.body) as Uint8Array<ArrayBuffer>),
        });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          headers[name.toLowerCase()] = value;
        });
        return {
          status: response.status,
          headers,
          body: plain(await response.arrayBuffer()),
        };
      },
    },
    clock: options.clock ?? realClock(),
    rememberedSession: {
      async save(record) {
        session = {
          repoUrl: record.repoUrl,
          coordinates: { ...record.coordinates },
          accessToken: record.accessToken,
          keys: {
            contentKey: storedKey(record.keys.contentKey),
            nameKey: storedKey(record.keys.nameKey),
            nameIvKey: storedKey(record.keys.nameIvKey),
            keyCheckKey: storedKey(record.keys.keyCheckKey),
          },
        };
      },
      async load() {
        if (session === null) {
          return null;
        }
        const reimport = (key: StoredKey) =>
          crypto.importKey(key.raw, key.algorithm);
        return {
          repoUrl: session.repoUrl,
          coordinates: { ...session.coordinates },
          accessToken: session.accessToken,
          keys: {
            contentKey: reimport(session.keys.contentKey),
            nameKey: reimport(session.keys.nameKey),
            nameIvKey: reimport(session.keys.nameIvKey),
            keyCheckKey: reimport(session.keys.keyCheckKey),
          },
        };
      },
      async clear() {
        session = null;
      },
    },
    blobCache: {
      async get(repoKey, blobSha) {
        const entry = blobs.get(repoKey)?.get(blobSha);
        return entry === undefined ? null : copyEntry(entry);
      },
      async put(repoKey, blobSha, entry) {
        let repo = blobs.get(repoKey);
        if (repo === undefined) {
          repo = new Map();
          blobs.set(repoKey, repo);
        }
        repo.set(blobSha, copyEntry(entry));
      },
      async touch(repoKey, blobSha, lastUsedAt) {
        const entry = blobs.get(repoKey)?.get(blobSha);
        if (entry !== undefined) {
          entry.lastUsedAt = lastUsedAt;
        }
      },
      async delete(repoKey, blobSha) {
        blobs.get(repoKey)?.delete(blobSha);
      },
      async list(repoKey) {
        return [
          ...(blobs.get(repoKey) ?? new Map<string, HostBlobCacheEntry>()),
        ].map(([blobSha, entry]) => ({
          blobSha,
          size: entry.bytes.length,
          lastUsedAt: entry.lastUsedAt,
        }));
      },
      async listRepos() {
        return [...blobs.keys()];
      },
      async deleteRepo(repoKey) {
        blobs.delete(repoKey);
      },
    },
    deviceSettings: {
      getItem: (key) => settings.get(key) ?? null,
      setItem: (key, value) => {
        settings.set(key, value);
      },
      removeItem: (key) => {
        settings.delete(key);
      },
    },
    log: {
      log(level, message) {
        logs.push({ level, message });
      },
    },
    imageCodec: createNodeImageCodec(imageInputs),
    post(message) {
      posted.push(message);
    },
  };
}
