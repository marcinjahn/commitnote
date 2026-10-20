import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptImage } from "../../crypto/image-cipher";
import { computeKeyCheck, deriveKeyring } from "../../crypto/keyring";
import { encryptName, encryptPath } from "../../crypto/name-cipher";
import { decryptNote, encryptNote } from "../../crypto/note-cipher";
import type { HostServices } from "../host-services";
import { checkTestVectors, TEST_VECTOR_FILES } from "../testing/check-vectors";
import { createNodeHostServices } from "../testing/node-host-services";
import {
  createCryptoShim,
  cryptoKeyFromHandle,
  handleOfCryptoKey,
  installCryptoShim,
} from "./crypto-shim";
import { hostArgon2id } from "./host-argon2";

const vectorModules = import.meta.glob<unknown>(
  "../../../apps/test-vectors/*.json",
  { eager: true, import: "default" },
);
const vectorFiles = Object.fromEntries(
  Object.entries(vectorModules).map(([path, content]) => [
    path.slice(path.lastIndexOf("/") + 1),
    content,
  ]),
);

function bytes(length: number, start = 0): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);
}

function toHex(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rejectionName(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).name;
  }
  return "resolved";
}

let host: HostServices;

function useShim(services: HostServices = createNodeHostServices()) {
  host = services;
  const shim = createCryptoShim(() => host);
  vi.stubGlobal("crypto", shim.crypto);
  vi.stubGlobal("CryptoKey", shim.CryptoKey);
  return shim;
}

beforeEach(() => {
  useShim();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("crypto shim", () => {
  it("reproduces every test vector over the Node host", async () => {
    expect(Object.keys(vectorFiles).sort()).toEqual(
      [...TEST_VECTOR_FILES].sort(),
    );
    const result = await checkTestVectors(
      vectorFiles,
      hostArgon2id(host.crypto),
    );
    expect(result.failures).toEqual([]);
    expect(result.checked).toBeGreaterThan(50);
  });

  it("reproduces the known-answer values of set A", async () => {
    const keyring = await deriveKeyring(
      "commitnote known answer",
      {
        algorithm: "argon2id",
        salt: bytes(16),
        memoryKiB: 1024,
        iterations: 1,
        parallelism: 1,
      },
      hostArgon2id(host.crypto),
    );
    expect(keyring.contentKey).toBeInstanceOf(CryptoKey);
    expect(await computeKeyCheck(keyring)).toBe(
      "Fwgxw4kavCNV6MMT02X5Wx8gjuC5vuoOCV9+6uo7Fbc=",
    );
    expect(await encryptName(keyring, "Projects")).toBe(
      "yPLu39QkVKbk49JHrV-ynCW3SVRZxK7zkHve0ofoHzy1WXyy",
    );
    expect(await encryptName(keyring, "Zażółć gęślą jaźń")).toBe(
      "9s-OyrV4-2oilTBQn2cgM0agia7r3Xp18bPbwJjCTS6y0L33sFZzD5RbuJt4dZvGM9vIfpQe",
    );
    expect(
      await encryptPath(keyring, ["Projects", "commitnote", "Ideas"]),
    ).toBe(
      "yPLu39QkVKbk49JHrV-ynCW3SVRZxK7zkHve0ofoHzy1WXyy/cYt9sdtJT8xAhnnKzS_kpiIBj7n4oAGLCM6QhhZsbugPgLl_mAU/3SutLemgp6ja5VtAeZljHBPySNOHH02pO5OVgzqpcXM9",
    );
    const note = await encryptNote(keyring, "# Hello\n\n- [ ] task\n", () =>
      bytes(12, 0x10),
    );
    expect(note).toBe(
      "v1:EBESExQVFhcYGRobV0RqAJINWc4SuhnwwhVtVLgsDpxszl4twB0GmbWmbIlPN++j",
    );
    expect(await decryptNote(keyring, note)).toBe("# Hello\n\n- [ ] task\n");
    const envelope = await encryptImage(
      keyring,
      "a".repeat(26),
      { type: "image/webp", width: 2, height: 3, bytes: bytes(10, 1) },
      () => bytes(12, 0x20),
    );
    expect(toHex(envelope)).toBe(
      "434e4901202122232425262728292a2bd0eb529516c57207e97d8384790aeb6f6022ba081c547529bbc68a73a61331d5febd672aa9a8206fbb1a71afcaba560e78949e0b399add569a7deacc12c30e4e128d488cb3ed025a85926bbf75a2eb8379d265754c51a29ce7ccfd2b323cb8b9",
    );
  });

  it("creates opaque, non-extractable keys backed by host handles", async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      bytes(32),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.type).toBe("secret");
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toEqual({
      name: "HMAC",
      hash: { name: "SHA-256" },
      length: 256,
    });
    expect(key.usages).toEqual(["sign", "verify"]);
    expect(Object.keys(key)).not.toContain("handle");

    const copy = cryptoKeyFromHandle(handleOfCryptoKey(key), "HMAC-SHA-256", [
      "sign",
    ]);
    expect(copy).toBeInstanceOf(CryptoKey);
    const data = bytes(5);
    expect(
      new Uint8Array(await crypto.subtle.sign("HMAC", copy, data)),
    ).toEqual(new Uint8Array(await crypto.subtle.sign("HMAC", key, data)));
    expect(() => handleOfCryptoKey({} as CryptoKey)).toThrow();
    expect(() => new CryptoKey()).toThrow(TypeError);
  });

  it("copies key bytes so callers may zero them", async () => {
    const raw = bytes(32);
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
      "encrypt",
    ]);
    const params = { name: "AES-GCM", iv: bytes(12) };
    const before = await crypto.subtle.encrypt(params, key, bytes(4));
    raw.fill(0);
    expect(await crypto.subtle.encrypt(params, key, bytes(4))).toEqual(before);
  });

  it("verifies HMAC signatures", async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      bytes(32),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const data = bytes(10);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
    expect(await crypto.subtle.verify("HMAC", key, mac, data)).toBe(true);
    mac[0] ^= 1;
    expect(await crypto.subtle.verify("HMAC", key, mac, data)).toBe(false);
    expect(
      await crypto.subtle.verify("HMAC", key, mac.subarray(0, 31), data),
    ).toBe(false);
  });

  it("enforces key usages", async () => {
    const encryptOnly = await crypto.subtle.importKey(
      "raw",
      bytes(32),
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const signOnly = await crypto.subtle.importKey(
      "raw",
      bytes(32),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const params = { name: "AES-GCM", iv: bytes(12) };
    expect(
      await rejectionName(
        crypto.subtle.decrypt(params, encryptOnly, bytes(32)),
      ),
    ).toBe("InvalidAccessError");
    expect(
      await rejectionName(
        crypto.subtle.verify("HMAC", signOnly, bytes(32), bytes(1)),
      ),
    ).toBe("InvalidAccessError");
    expect(
      await rejectionName(crypto.subtle.encrypt(params, signOnly, bytes(1))),
    ).toBe("InvalidAccessError");
    expect(
      await rejectionName(
        crypto.subtle.importKey("raw", bytes(32), "HKDF", false, ["sign"]),
      ),
    ).toBe("SyntaxError");
  });

  it("rejects tampered ciphertexts with OperationError", async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      bytes(32),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
    const params = { name: "AES-GCM", iv: bytes(12), additionalData: bytes(3) };
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(params, key, bytes(20)),
    );
    expect(sealed).toHaveLength(36);
    sealed[sealed.length - 1] ^= 1;
    expect(
      await rejectionName(crypto.subtle.decrypt(params, key, sealed)),
    ).toBe("OperationError");
    expect(
      await rejectionName(crypto.subtle.decrypt(params, key, bytes(15))),
    ).toBe("OperationError");
  });

  it("rejects anything outside the supported surface with NotSupportedError", async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      bytes(32),
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const subtle = crypto.subtle;
    const attempts: Promise<unknown>[] = [
      subtle.importKey("raw", bytes(16), "AES-CBC", false, ["encrypt"]),
      subtle.importKey("raw", bytes(32), "AES-GCM", true, ["encrypt"]),
      subtle.importKey(
        "raw",
        bytes(32),
        { name: "HMAC", hash: "SHA-512" },
        false,
        ["sign"],
      ),
      subtle.importKey("jwk", { kty: "oct" }, "AES-GCM", false, ["encrypt"]),
      subtle.encrypt({ name: "AES-GCM", iv: bytes(16) }, key, bytes(1)),
      subtle.encrypt(
        { name: "AES-GCM", iv: bytes(12), tagLength: 96 },
        key,
        bytes(1),
      ),
      subtle.encrypt(
        { name: "AES-CTR", counter: bytes(16), length: 64 },
        key,
        bytes(1),
      ),
      subtle.digest("SHA-512", bytes(1)),
      subtle.exportKey("raw", key),
      subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]),
    ];
    for (const attempt of attempts) {
      expect(await rejectionName(attempt)).toBe("NotSupportedError");
    }
  });

  it("fills integer arrays from host random bytes within the WebCrypto limit", () => {
    const randomBytes = vi.fn((length: number) =>
      new Uint8Array(length).fill(0xff),
    );
    useShim({ ...createNodeHostServices(), random: { randomBytes } });
    const array = new Uint32Array(4);
    expect(crypto.getRandomValues(array)).toBe(array);
    expect([...array]).toEqual([
      0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff,
    ]);
    expect(randomBytes).toHaveBeenCalledWith(16);

    expect(crypto.getRandomValues(new Uint8Array(65536))).toHaveLength(65536);
    expect(() => crypto.getRandomValues(new Uint8Array(65537))).toThrow(
      expect.objectContaining({ name: "QuotaExceededError" }),
    );
    expect(() =>
      crypto.getRandomValues(new Float32Array(1) as unknown as Uint8Array<ArrayBuffer>),
    ).toThrow(expect.objectContaining({ name: "TypeMismatchError" }));
  });

  it("returns RFC 4122 version 4 UUIDs from host random bytes", () => {
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(crypto.randomUUID()).toMatch(uuid);
    expect(crypto.randomUUID()).not.toBe(crypto.randomUUID());
    useShim({
      ...createNodeHostServices(),
      random: { randomBytes: (length) => new Uint8Array(length).fill(0xff) },
    });
    expect(crypto.randomUUID()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("resolves the host lazily and fails clearly before it exists", async () => {
    let lateHost: HostServices | undefined;
    const target: Record<string, unknown> = {};
    installCryptoShim(target, () => lateHost);
    const shimCrypto = target.crypto as Crypto;
    expect(typeof target.CryptoKey).toBe("function");
    expect(() => shimCrypto.randomUUID()).toThrow(/host services/);
    await expect(shimCrypto.subtle.digest("SHA-256", bytes(1))).rejects.toThrow(
      /host services/,
    );
    lateHost = createNodeHostServices();
    expect(
      toHex(new Uint8Array(await shimCrypto.subtle.digest("SHA-256", new Uint8Array(0)))),
    ).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
