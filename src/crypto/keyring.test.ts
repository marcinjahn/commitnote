import { describe, expect, it } from "vitest";
import { KDF_DEFAULTS } from "../format/v1";
import { argon2idDirect } from "./argon2";
import {
  computeKeyCheck,
  createRepoConfig,
  deriveKeyring,
  verifyKeyCheck,
} from "./keyring";
import type { KdfParams } from "./repo-config";
import { parseRepoConfig } from "./repo-config";

const REDUCED_KDF: Pick<KdfParams, "memoryKiB" | "iterations" | "parallelism"> =
  {
    memoryKiB: 64,
    iterations: 1,
    parallelism: 1,
  };

function salt(byte: number): Uint8Array {
  return Uint8Array.from({ length: 16 }, () => byte);
}

function kdfParams(overrides: Partial<KdfParams> = {}): KdfParams {
  return {
    algorithm: "argon2id",
    memoryKiB: REDUCED_KDF.memoryKiB,
    iterations: REDUCED_KDF.iterations,
    parallelism: REDUCED_KDF.parallelism,
    salt: salt(1),
    ...overrides,
  };
}

describe("deriveKeyring", () => {
  it("derives non-extractable keys with the stated algorithms and usages", async () => {
    const keyring = await deriveKeyring(
      "correct horse battery staple",
      kdfParams(),
      argon2idDirect,
    );

    expect(keyring.contentKey.extractable).toBe(false);
    expect(keyring.contentKey.algorithm.name).toBe("AES-GCM");
    expect([...keyring.contentKey.usages].sort()).toEqual([
      "decrypt",
      "encrypt",
    ]);

    expect(keyring.nameKey.extractable).toBe(false);
    expect(keyring.nameKey.algorithm.name).toBe("AES-GCM");
    expect([...keyring.nameKey.usages].sort()).toEqual(["decrypt", "encrypt"]);

    expect(keyring.nameIvKey.extractable).toBe(false);
    expect(keyring.nameIvKey.algorithm.name).toBe("HMAC");
    expect((keyring.nameIvKey.algorithm as HmacKeyAlgorithm).hash.name).toBe(
      "SHA-256",
    );
    expect([...keyring.nameIvKey.usages].sort()).toEqual(["sign", "verify"]);

    expect(keyring.keyCheckKey.extractable).toBe(false);
    expect(keyring.keyCheckKey.algorithm.name).toBe("HMAC");
    expect((keyring.keyCheckKey.algorithm as HmacKeyAlgorithm).hash.name).toBe(
      "SHA-256",
    );
    expect([...keyring.keyCheckKey.usages].sort()).toEqual(["sign", "verify"]);
  });

  it("derives the same key check for the same passphrase and salt", async () => {
    const kdf = kdfParams();
    const a = await deriveKeyring("passphrase", kdf, argon2idDirect);
    const b = await deriveKeyring("passphrase", kdf, argon2idDirect);
    expect(await computeKeyCheck(a)).toBe(await computeKeyCheck(b));
  });

  it("derives a different key check for a different passphrase", async () => {
    const kdf = kdfParams();
    const a = await deriveKeyring("passphrase one", kdf, argon2idDirect);
    const b = await deriveKeyring("passphrase two", kdf, argon2idDirect);
    expect(await computeKeyCheck(a)).not.toBe(await computeKeyCheck(b));
  });

  it("derives a different key check for a different salt", async () => {
    const a = await deriveKeyring(
      "passphrase",
      kdfParams({ salt: salt(1) }),
      argon2idDirect,
    );
    const b = await deriveKeyring(
      "passphrase",
      kdfParams({ salt: salt(2) }),
      argon2idDirect,
    );
    expect(await computeKeyCheck(a)).not.toBe(await computeKeyCheck(b));
  });

  it("gives the same key check for NFC and NFD forms of the same passphrase", async () => {
    const kdf = kdfParams();
    const nfc = "café"; // "café", composed
    const nfd = "café"; // "café", "e" + combining acute accent
    expect(nfc).not.toBe(nfd);
    expect(nfc.normalize("NFC")).toBe(nfd.normalize("NFC"));

    const a = await deriveKeyring(nfc, kdf, argon2idDirect);
    const b = await deriveKeyring(nfd, kdf, argon2idDirect);
    expect(await computeKeyCheck(a)).toBe(await computeKeyCheck(b));
  });
});

describe("verifyKeyCheck", () => {
  it("is true for the right passphrase", async () => {
    const { config, keyring } = await createRepoConfig("right passphrase", {
      kdf: REDUCED_KDF,
      random: () => salt(7),
      argon2id: argon2idDirect,
    });
    expect(await verifyKeyCheck(keyring, config)).toBe(true);
  });

  it("is false for the wrong passphrase", async () => {
    const { config } = await createRepoConfig("right passphrase", {
      kdf: REDUCED_KDF,
      random: () => salt(7),
      argon2id: argon2idDirect,
    });
    const wrongKeyring = await deriveKeyring(
      "wrong passphrase",
      config.kdf,
      argon2idDirect,
    );
    expect(await verifyKeyCheck(wrongKeyring, config)).toBe(false);
  });

  it("is false for a config whose keyCheck is altered", async () => {
    const { config, keyring } = await createRepoConfig("right passphrase", {
      kdf: REDUCED_KDF,
      random: () => salt(7),
      argon2id: argon2idDirect,
    });
    const tampered = {
      ...config,
      keyCheck: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    };
    expect(await verifyKeyCheck(keyring, tampered)).toBe(false);
  });

  it("is false for a malformed keyCheck", async () => {
    const { config, keyring } = await createRepoConfig("right passphrase", {
      kdf: REDUCED_KDF,
      random: () => salt(7),
      argon2id: argon2idDirect,
    });
    const tampered = { ...config, keyCheck: "not-base64!!" };
    expect(await verifyKeyCheck(keyring, tampered)).toBe(false);
  });
});

describe("createRepoConfig", () => {
  it("produces a config that fails parseRepoConfig when reduced KDF values are used", async () => {
    const { configText } = await createRepoConfig("passphrase", {
      kdf: REDUCED_KDF,
      random: () => salt(9),
      argon2id: argon2idDirect,
    });
    expect(parseRepoConfig(configText).kind).toBe("invalid");
  });

  it("uses the injected random and now, and parses back as valid at the default KDF parameters", async () => {
    const fixedSalt = salt(3);
    const fixedNow = new Date("2026-01-02T03:04:05.000Z");
    const { config, configText } = await createRepoConfig("passphrase", {
      random: () => fixedSalt,
      now: () => fixedNow,
      argon2id: argon2idDirect,
    });

    expect(config.kdf.salt).toEqual(fixedSalt);
    expect(config.kdf.memoryKiB).toBe(KDF_DEFAULTS.memoryKiB);
    expect(config.kdf.iterations).toBe(KDF_DEFAULTS.iterations);
    expect(config.kdf.parallelism).toBe(KDF_DEFAULTS.parallelism);
    expect(config.createdAt).toBe(fixedNow.toISOString());

    expect(parseRepoConfig(configText).kind).toBe("valid");
  });

  it("round-trips at the real default parameters", async () => {
    const passphrase = "a real passphrase";
    const { config, configText, keyring } = await createRepoConfig(passphrase, {
      argon2id: argon2idDirect,
    });
    expect(await verifyKeyCheck(keyring, config)).toBe(true);

    const parsed = parseRepoConfig(configText);
    if (parsed.kind !== "valid") {
      throw new Error(`expected a valid config, got ${parsed.kind}`);
    }

    const rederivedKeyring = await deriveKeyring(
      passphrase,
      parsed.config.kdf,
      argon2idDirect,
    );
    expect(await verifyKeyCheck(rederivedKeyring, parsed.config)).toBe(true);
  });
});
