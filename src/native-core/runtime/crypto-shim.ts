import type {
  HostKeyAlgorithm,
  HostServices,
  KeyHandle,
} from "../host-services";

type ShimKeyAlgorithm =
  | { name: "AES-GCM"; length: number }
  | { name: "HMAC"; hash: { name: "SHA-256" }; length: number }
  | { name: "HKDF" };

const ALLOWED_USAGES: Record<HostKeyAlgorithm, readonly KeyUsage[]> = {
  "AES-GCM": ["encrypt", "decrypt"],
  "HMAC-SHA-256": ["sign", "verify"],
  HKDF: ["deriveBits"],
};

const MAX_RANDOM_BYTES = 65536;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const SHA256_BYTES = 32;

const handles = new WeakMap<object, KeyHandle>();
const constructToken = Symbol("CryptoKey");

function domError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

class ShimCryptoKey {
  readonly type = "secret" as const;
  readonly extractable = false;
  readonly algorithm: ShimKeyAlgorithm;
  readonly usages: KeyUsage[];

  constructor(
    token: symbol,
    handle: KeyHandle,
    algorithm: ShimKeyAlgorithm,
    usages: readonly KeyUsage[],
  ) {
    if (token !== constructToken) {
      throw new TypeError("Illegal constructor");
    }
    handles.set(this, handle);
    this.algorithm = algorithm;
    this.usages = [...usages];
    Object.freeze(this.usages);
  }

  get [Symbol.toStringTag](): string {
    return "CryptoKey";
  }
}

function shimAlgorithm(
  algorithm: HostKeyAlgorithm,
  lengthBits: number,
): ShimKeyAlgorithm {
  switch (algorithm) {
    case "AES-GCM":
      return { name: "AES-GCM", length: lengthBits };
    case "HMAC-SHA-256":
      return { name: "HMAC", hash: { name: "SHA-256" }, length: lengthBits };
    case "HKDF":
      return { name: "HKDF" };
  }
}

export function cryptoKeyFromHandle(
  handle: KeyHandle,
  algorithm: HostKeyAlgorithm,
  usages: KeyUsage[],
  lengthBits = 256,
): CryptoKey {
  return new ShimCryptoKey(
    constructToken,
    handle,
    shimAlgorithm(algorithm, lengthBits),
    usages,
  ) as unknown as CryptoKey;
}

export function handleOfCryptoKey(key: CryptoKey): KeyHandle {
  const handle = handles.get(key);
  if (handle === undefined) {
    throw domError("InvalidAccessError", "Not a key of this crypto shim");
  }
  return handle;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  const tag = Object.prototype.toString.call(value);
  return tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]";
}

function copyBytes(source: unknown, what: string): Uint8Array {
  if (ArrayBuffer.isView(source)) {
    const view = new Uint8Array(
      source.buffer,
      source.byteOffset,
      source.byteLength,
    );
    const copy = new Uint8Array(view.length);
    copy.set(view);
    return copy;
  }
  if (isArrayBuffer(source)) {
    const view = new Uint8Array(source);
    const copy = new Uint8Array(view.length);
    copy.set(view);
    return copy;
  }
  throw new TypeError(`${what} is not a BufferSource`);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out.buffer;
}

function algorithmName(algorithm: unknown): string {
  if (typeof algorithm === "string") {
    return algorithm.toUpperCase();
  }
  if (
    typeof algorithm === "object" &&
    algorithm !== null &&
    typeof (algorithm as { name?: unknown }).name === "string"
  ) {
    return (algorithm as { name: string }).name.toUpperCase();
  }
  throw new TypeError("Algorithm must be a string or an object with a name");
}

function algorithmParams(algorithm: unknown): Record<string, unknown> {
  return typeof algorithm === "object" && algorithm !== null
    ? (algorithm as Record<string, unknown>)
    : {};
}

function requireSha256(hash: unknown): void {
  if (hash === undefined || algorithmName(hash) !== "SHA-256") {
    throw domError("NotSupportedError", "Only SHA-256 is supported");
  }
}

function asShimKey(
  key: unknown,
  name: ShimKeyAlgorithm["name"],
  usage: KeyUsage,
): ShimCryptoKey {
  if (!(key instanceof ShimCryptoKey) || !handles.has(key)) {
    throw domError("InvalidAccessError", "Not a key of this crypto shim");
  }
  if (key.algorithm.name !== name) {
    throw domError(
      "InvalidAccessError",
      `Key algorithm does not match ${name}`,
    );
  }
  if (!key.usages.includes(usage)) {
    throw domError("InvalidAccessError", `Key does not allow ${usage}`);
  }
  return key;
}

function aesGcmParams(algorithm: unknown): {
  iv: Uint8Array;
  additionalData: Uint8Array;
} {
  if (algorithmName(algorithm) !== "AES-GCM") {
    throw domError("NotSupportedError", "Only AES-GCM is supported");
  }
  const params = algorithmParams(algorithm);
  const iv = copyBytes(params.iv, "iv");
  if (iv.length !== AES_GCM_IV_BYTES) {
    throw domError(
      "NotSupportedError",
      "Only 12-byte AES-GCM IVs are supported",
    );
  }
  if (params.tagLength !== undefined && params.tagLength !== AES_GCM_TAG_BITS) {
    throw domError(
      "NotSupportedError",
      "Only 128-bit AES-GCM tags are supported",
    );
  }
  const additionalData =
    params.additionalData === undefined
      ? new Uint8Array(0)
      : copyBytes(params.additionalData, "additionalData");
  return { iv, additionalData };
}

function requireHmac(algorithm: unknown): void {
  if (algorithmName(algorithm) !== "HMAC") {
    throw domError("NotSupportedError", "Only HMAC is supported");
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

function integerArrayTag(value: unknown): boolean {
  switch (Object.prototype.toString.call(value)) {
    case "[object Int8Array]":
    case "[object Uint8Array]":
    case "[object Uint8ClampedArray]":
    case "[object Int16Array]":
    case "[object Uint16Array]":
    case "[object Int32Array]":
    case "[object Uint32Array]":
    case "[object BigInt64Array]":
    case "[object BigUint64Array]":
      return true;
    default:
      return false;
  }
}

function hex(bytes: Uint8Array, from: number, to: number): string {
  let out = "";
  for (let index = from; index < to; index++) {
    out += bytes[index].toString(16).padStart(2, "0");
  }
  return out;
}

export function createCryptoShim(getHost: () => HostServices | undefined): {
  crypto: Crypto;
  CryptoKey: typeof ShimCryptoKey;
} {
  function host(): HostServices {
    const services = getHost();
    if (!services) {
      throw new Error("Crypto shim used before host services are available");
    }
    return services;
  }

  function randomBytes(length: number): Uint8Array {
    const bytes = host().random.randomBytes(length);
    if (bytes.length !== length) {
      throw domError(
        "OperationError",
        "Host returned the wrong number of random bytes",
      );
    }
    return bytes;
  }

  function importKey(
    format: unknown,
    keyData: unknown,
    algorithm: unknown,
    extractable: unknown,
    usages: unknown,
  ): CryptoKey {
    if (format !== "raw") {
      throw domError("NotSupportedError", "Only raw keys are supported");
    }
    if (extractable !== false) {
      throw domError(
        "NotSupportedError",
        "Only non-extractable keys are supported",
      );
    }
    let hostAlgorithm: HostKeyAlgorithm;
    switch (algorithmName(algorithm)) {
      case "AES-GCM":
        hostAlgorithm = "AES-GCM";
        break;
      case "HMAC":
        hostAlgorithm = "HMAC-SHA-256";
        requireSha256(algorithmParams(algorithm).hash);
        break;
      case "HKDF":
        hostAlgorithm = "HKDF";
        break;
      default:
        throw domError("NotSupportedError", "Unsupported key algorithm");
    }
    const requested = Array.isArray(usages) ? (usages as KeyUsage[]) : [];
    if (
      requested.length === 0 ||
      requested.some((usage) => !ALLOWED_USAGES[hostAlgorithm].includes(usage))
    ) {
      throw domError("SyntaxError", "Invalid key usages");
    }
    const raw = copyBytes(keyData, "keyData");
    try {
      const lengthBits = raw.length * 8;
      if (hostAlgorithm === "AES-GCM" && ![16, 24, 32].includes(raw.length)) {
        throw domError("DataError", "AES key must be 128, 192 or 256 bits");
      }
      if (hostAlgorithm === "HMAC-SHA-256") {
        if (raw.length === 0) {
          throw domError("DataError", "HMAC key must not be empty");
        }
        const length = algorithmParams(algorithm).length;
        if (length !== undefined && length !== lengthBits) {
          throw domError(
            "NotSupportedError",
            "HMAC key length must match the key data",
          );
        }
      }
      const handle = host().crypto.importKey(raw, hostAlgorithm);
      return cryptoKeyFromHandle(
        handle,
        hostAlgorithm,
        [...new Set(requested)],
        lengthBits,
      );
    } finally {
      raw.fill(0);
    }
  }

  function encrypt(
    algorithm: unknown,
    key: unknown,
    data: unknown,
  ): ArrayBuffer {
    const { iv, additionalData } = aesGcmParams(algorithm);
    const shimKey = asShimKey(key, "AES-GCM", "encrypt");
    const plaintext = copyBytes(data, "data");
    return toArrayBuffer(
      host().crypto.aesGcmEncrypt(
        handles.get(shimKey)!,
        iv,
        additionalData,
        plaintext,
      ),
    );
  }

  function decrypt(
    algorithm: unknown,
    key: unknown,
    data: unknown,
  ): ArrayBuffer {
    const { iv, additionalData } = aesGcmParams(algorithm);
    const shimKey = asShimKey(key, "AES-GCM", "decrypt");
    const sealed = copyBytes(data, "data");
    if (sealed.length < AES_GCM_TAG_BITS / 8) {
      throw domError("OperationError", "Decryption failed");
    }
    const plaintext = host().crypto.aesGcmDecrypt(
      handles.get(shimKey)!,
      iv,
      additionalData,
      sealed,
    );
    if (plaintext === null) {
      throw domError("OperationError", "Decryption failed");
    }
    return toArrayBuffer(plaintext);
  }

  function hmac(key: ShimCryptoKey, data: unknown): Uint8Array {
    return host().crypto.hmacSha256(handles.get(key)!, copyBytes(data, "data"));
  }

  function sign(algorithm: unknown, key: unknown, data: unknown): ArrayBuffer {
    requireHmac(algorithm);
    return toArrayBuffer(hmac(asShimKey(key, "HMAC", "sign"), data));
  }

  function verify(
    algorithm: unknown,
    key: unknown,
    signature: unknown,
    data: unknown,
  ): boolean {
    requireHmac(algorithm);
    const shimKey = asShimKey(key, "HMAC", "verify");
    const expected = copyBytes(signature, "signature");
    return constantTimeEqual(hmac(shimKey, data), expected);
  }

  function deriveBits(
    algorithm: unknown,
    key: unknown,
    length: unknown,
  ): ArrayBuffer {
    if (algorithmName(algorithm) !== "HKDF") {
      throw domError("NotSupportedError", "Only HKDF is supported");
    }
    const params = algorithmParams(algorithm);
    requireSha256(params.hash);
    const salt = copyBytes(params.salt, "salt");
    const info = copyBytes(params.info, "info");
    const shimKey = asShimKey(key, "HKDF", "deriveBits");
    if (
      typeof length !== "number" ||
      !Number.isInteger(length) ||
      length < 0 ||
      length % 8 !== 0 ||
      length > 255 * SHA256_BYTES * 8
    ) {
      throw domError("OperationError", "Invalid HKDF length");
    }
    if (length === 0) {
      return new ArrayBuffer(0);
    }
    return toArrayBuffer(
      host().crypto.hkdfSha256(handles.get(shimKey)!, salt, info, length / 8),
    );
  }

  function digest(algorithm: unknown, data: unknown): ArrayBuffer {
    const name = algorithmName(algorithm);
    if (name !== "SHA-1" && name !== "SHA-256") {
      throw domError(
        "NotSupportedError",
        "Only SHA-1 and SHA-256 are supported",
      );
    }
    return toArrayBuffer(host().crypto.digest(name, copyBytes(data, "data")));
  }

  function asPromise<A extends unknown[], R>(
    operation: (...args: A) => R,
  ): (...args: A) => Promise<R> {
    return (...args) => {
      try {
        return Promise.resolve(operation(...args));
      } catch (error) {
        return Promise.reject(error);
      }
    };
  }

  const unsupported = () =>
    Promise.reject(domError("NotSupportedError", "Operation is not supported"));

  const subtle = {
    importKey: asPromise(importKey),
    encrypt: asPromise(encrypt),
    decrypt: asPromise(decrypt),
    sign: asPromise(sign),
    verify: asPromise(verify),
    deriveBits: asPromise(deriveBits),
    digest: asPromise(digest),
    deriveKey: unsupported,
    exportKey: unsupported,
    generateKey: unsupported,
    unwrapKey: unsupported,
    wrapKey: unsupported,
  };

  function getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    if (!ArrayBuffer.isView(array) || !integerArrayTag(array)) {
      throw domError("TypeMismatchError", "Expected an integer typed array");
    }
    if (array.byteLength > MAX_RANDOM_BYTES) {
      throw domError(
        "QuotaExceededError",
        `Cannot generate more than ${MAX_RANDOM_BYTES} random bytes at once`,
      );
    }
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(
      randomBytes(array.byteLength),
    );
    return array;
  }

  function randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
    const bytes = new Uint8Array(randomBytes(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return `${hex(bytes, 0, 4)}-${hex(bytes, 4, 6)}-${hex(bytes, 6, 8)}-${hex(bytes, 8, 10)}-${hex(bytes, 10, 16)}`;
  }

  const crypto = { subtle, getRandomValues, randomUUID };
  return {
    crypto: crypto as unknown as Crypto,
    CryptoKey: ShimCryptoKey,
  };
}

export function installCryptoShim(
  target: Record<string, unknown>,
  getHost: () => HostServices | undefined,
): void {
  const shim = createCryptoShim(getHost);
  target.crypto = shim.crypto;
  target.CryptoKey = shim.CryptoKey;
}
