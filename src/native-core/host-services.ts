export type KeyHandle = string;
export type HostKeyAlgorithm = "AES-GCM" | "HMAC-SHA-256" | "HKDF";

export interface HostCrypto {
  /** Copies the bytes; the caller may zero its array afterwards. */
  importKey(raw: Uint8Array, algorithm: HostKeyAlgorithm): KeyHandle;
  /** Returns ciphertext followed by the 16-byte tag. */
  aesGcmEncrypt(
    key: KeyHandle,
    iv: Uint8Array,
    additionalData: Uint8Array,
    plaintext: Uint8Array,
  ): Uint8Array;
  /** Returns null when authentication fails. */
  aesGcmDecrypt(
    key: KeyHandle,
    iv: Uint8Array,
    additionalData: Uint8Array,
    sealed: Uint8Array,
  ): Uint8Array | null;
  hkdfSha256(
    key: KeyHandle,
    salt: Uint8Array,
    info: Uint8Array,
    lengthBytes: number,
  ): Uint8Array;
  hmacSha256(key: KeyHandle, data: Uint8Array): Uint8Array;
  digest(algorithm: "SHA-1" | "SHA-256", data: Uint8Array): Uint8Array;
  /** Runs off the core runtime's executor. */
  argon2id(input: {
    password: Uint8Array;
    salt: Uint8Array;
    memoryKiB: number;
    iterations: number;
    parallelism: number;
    hashLength: number;
  }): Promise<Uint8Array>;
}

export interface HostRandom {
  randomBytes(length: number): Uint8Array;
}

export interface HostHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

/** Header names are lower-case. */
export interface HostHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** Rejects only on transport failure; any HTTP status resolves. */
export interface HostHttp {
  request(request: HostHttpRequest): Promise<HostHttpResponse>;
}

/** `now()` is epoch milliseconds. */
export interface HostClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface RememberedSessionRecord {
  repoUrl: string;
  coordinates: { forge: "github" | "gitlab"; owner: string; repo: string };
  accessToken: string;
  keys: {
    contentKey: KeyHandle;
    nameKey: KeyHandle;
    nameIvKey: KeyHandle;
    keyCheckKey: KeyHandle;
  };
}

export interface HostRememberedSessionStorage {
  /** The host persists the raw key material behind the handles, never a passphrase. */
  save(record: RememberedSessionRecord): Promise<void>;
  /** The host re-imports the key material and returns fresh handles. */
  load(): Promise<RememberedSessionRecord | null>;
  clear(): Promise<void>;
}

export interface HostBlobCacheEntry {
  bytes: Uint8Array;
  text: boolean;
  lastUsedAt: number;
}

export interface HostBlobCacheStorage {
  get(repoKey: string, blobSha: string): Promise<HostBlobCacheEntry | null>;
  put(
    repoKey: string,
    blobSha: string,
    entry: HostBlobCacheEntry,
  ): Promise<void>;
  touch(repoKey: string, blobSha: string, lastUsedAt: number): Promise<void>;
  delete(repoKey: string, blobSha: string): Promise<void>;
  list(
    repoKey: string,
  ): Promise<{ blobSha: string; size: number; lastUsedAt: number }[]>;
  listRepos(): Promise<string[]>;
  deleteRepo(repoKey: string): Promise<void>;
}

/** Synchronous, same shape as the existing `StorageLike`. */
export interface HostDeviceSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type HostLogLevel = "debug" | "info" | "warn" | "error";

/** Never receives note contents, names or paths. */
export interface HostLog {
  log(level: HostLogLevel, message: string): void;
}

export interface HostServices {
  crypto: HostCrypto;
  random: HostRandom;
  http: HostHttp;
  clock: HostClock;
  rememberedSession: HostRememberedSessionStorage;
  blobCache: HostBlobCacheStorage;
  deviceSettings: HostDeviceSettingsStorage;
  log: HostLog;
  /** The single outbound channel of the native core API: responses and core events as JSON text. */
  post(message: string): void;
}
