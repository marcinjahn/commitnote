import { describe, expect, it } from "vitest";
import { KDF_LIMITS } from "../format/v1";
import { toBase64 } from "./base64";
import {
  parseRepoConfig,
  serializeRepoConfig,
  type KdfParams,
  type RepoConfig,
} from "./repo-config";

const SALT = Uint8Array.from({ length: 16 }, (_, i) => i);
const SALT_B64 = "AAECAwQFBgcICQoLDA0ODw==";
const KEY_CHECK_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

function validKdf(overrides: Partial<KdfParams> = {}): KdfParams {
  return {
    algorithm: "argon2id",
    memoryKiB: KDF_LIMITS.minMemoryKiB,
    iterations: KDF_LIMITS.minIterations,
    parallelism: KDF_LIMITS.minParallelism,
    salt: SALT,
    ...overrides,
  };
}

function validConfig(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    formatVersion: 1,
    app: "commitnote",
    cipher: "AES-256-GCM",
    nameScheme: "AES-256-GCM-SIV-HMAC-SHA256/base64url",
    kdf: validKdf(),
    keyCheck: KEY_CHECK_B64,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function validJson(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    formatVersion: 1,
    app: "commitnote",
    cipher: "AES-256-GCM",
    nameScheme: "AES-256-GCM-SIV-HMAC-SHA256/base64url",
    kdf: {
      algorithm: "argon2id",
      memoryKiB: KDF_LIMITS.minMemoryKiB,
      iterations: KDF_LIMITS.minIterations,
      parallelism: KDF_LIMITS.minParallelism,
      salt: SALT_B64,
    },
    keyCheck: KEY_CHECK_B64,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function validKdfJson(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return validJson({
    kdf: {
      algorithm: "argon2id",
      memoryKiB: KDF_LIMITS.minMemoryKiB,
      iterations: KDF_LIMITS.minIterations,
      parallelism: KDF_LIMITS.minParallelism,
      salt: SALT_B64,
      ...overrides,
    },
  });
}

function expectInvalid(text: string) {
  const result = parseRepoConfig(text);
  expect(result.kind).toBe("invalid");
}

describe("parseRepoConfig / serializeRepoConfig round trip", () => {
  it("round-trips a valid config", () => {
    const config = validConfig();
    const text = serializeRepoConfig(config);
    const result = parseRepoConfig(text);
    expect(result).toEqual({ kind: "valid", config });
  });

  it("round-trips with non-default kdf bounds", () => {
    const config = validConfig({
      kdf: validKdf({
        memoryKiB: 1048576,
        iterations: 10,
        parallelism: 4,
      }),
    });
    const text = serializeRepoConfig(config);
    expect(parseRepoConfig(text)).toEqual({ kind: "valid", config });
  });

  it("pins the exact serialized text", () => {
    const config = validConfig();
    expect(serializeRepoConfig(config)).toBe(
      `{
  "formatVersion": 1,
  "app": "commitnote",
  "cipher": "AES-256-GCM",
  "nameScheme": "AES-256-GCM-SIV-HMAC-SHA256/base64url",
  "kdf": {
    "algorithm": "argon2id",
    "memoryKiB": 65536,
    "iterations": 3,
    "parallelism": 1,
    "salt": "AAECAwQFBgcICQoLDA0ODw=="
  },
  "keyCheck": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
`,
    );
  });
});

describe("parseRepoConfig / serializeRepoConfig: settings", () => {
  it("omits the settings key when the config has none", () => {
    const text = serializeRepoConfig(validConfig());
    expect(Object.keys(JSON.parse(text))).not.toContain("settings");
    const result = parseRepoConfig(text);
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect("settings" in result.config).toBe(false);
    }
  });

  it("exposes an object settings value on a valid config", () => {
    const settings = { theme: "dark" };
    const result = parseRepoConfig(JSON.stringify(validJson({ settings })));
    expect(result).toEqual({
      kind: "valid",
      config: validConfig({ settings }),
    });
  });

  it("preserves unknown keys and nested values through parse and serialize", () => {
    const settings = {
      unknownKey: 1,
      nested: { list: [1, { deep: null }], flag: true },
    };
    const first = parseRepoConfig(JSON.stringify(validJson({ settings })));
    if (first.kind !== "valid") throw new Error("expected valid");
    const second = parseRepoConfig(serializeRepoConfig(first.config));
    expect(second).toEqual({ kind: "valid", config: first.config });
    if (second.kind !== "valid") throw new Error("expected valid");
    expect(second.config.settings).toEqual(settings);
  });

  it.each([["x"], [[1]], [null], [5], [true]])(
    "accepts non-object settings %j and serializes it back",
    (settings) => {
      const result = parseRepoConfig(JSON.stringify(validJson({ settings })));
      expect(result.kind).toBe("valid");
      if (result.kind !== "valid") return;
      expect(result.config.settings).toEqual(settings);
      const reparsed = parseRepoConfig(serializeRepoConfig(result.config));
      expect(reparsed).toEqual(result);
    },
  );

  it("rejects another top-level key alongside settings", () => {
    expectInvalid(
      JSON.stringify(validJson({ settings: {}, extra: "field" })),
    );
  });

  it("writes settings after createdAt", () => {
    const text = serializeRepoConfig(validConfig({ settings: { a: 1 } }));
    const keys = Object.keys(JSON.parse(text));
    expect(keys[keys.length - 1]).toBe("settings");
    expect(keys[keys.length - 2]).toBe("createdAt");
  });
});

describe("parseRepoConfig: malformed input", () => {
  it("rejects text that is not JSON", () => {
    expectInvalid("not json");
  });

  it("rejects a JSON value that is not a plain object", () => {
    expectInvalid("42");
    expectInvalid("null");
    expectInvalid("[]");
    expectInvalid('"commitnote"');
  });

  it("rejects the wrong app id", () => {
    expectInvalid(JSON.stringify(validJson({ app: "not-commitnote" })));
  });

  it("rejects formatVersion 0", () => {
    expectInvalid(JSON.stringify(validJson({ formatVersion: 0 })));
  });

  it("rejects a non-integer formatVersion", () => {
    expectInvalid(JSON.stringify(validJson({ formatVersion: 1.5 })));
  });
});

describe("parseRepoConfig: newer format", () => {
  it("returns newerFormat for formatVersion 2, ignoring the rest of the shape", () => {
    const result = parseRepoConfig(
      JSON.stringify({
        formatVersion: 2,
        app: "commitnote",
        somethingUnknown: true,
      }),
    );
    expect(result).toEqual({ kind: "newerFormat", formatVersion: 2 });
  });
});

describe("parseRepoConfig: strict v1 shape", () => {
  it("rejects an unrecognized cipher identifier", () => {
    expectInvalid(JSON.stringify(validJson({ cipher: "AES-128-GCM" })));
  });

  it("rejects an unrecognized nameScheme identifier", () => {
    expectInvalid(JSON.stringify(validJson({ nameScheme: "unknown" })));
  });

  it("rejects an unrecognized kdf.algorithm identifier", () => {
    expectInvalid(JSON.stringify(validKdfJson({ algorithm: "argon2i" })));
  });

  it("rejects an extra top-level key", () => {
    expectInvalid(JSON.stringify(validJson({ extra: "field" })));
  });

  it("rejects a missing top-level key", () => {
    const json = validJson();
    delete json.createdAt;
    expectInvalid(JSON.stringify(json));
  });

  it("rejects an extra kdf key", () => {
    expectInvalid(JSON.stringify(validKdfJson({ extra: "field" })));
  });

  it("rejects a missing kdf key", () => {
    const json = validJson();
    delete (json.kdf as Record<string, unknown>).parallelism;
    expectInvalid(JSON.stringify(json));
  });

  it("rejects bad base64 for salt", () => {
    expectInvalid(JSON.stringify(validKdfJson({ salt: "not base64!" })));
  });

  it("rejects bad base64 for keyCheck", () => {
    expectInvalid(JSON.stringify(validJson({ keyCheck: "not base64!" })));
  });

  it("rejects a createdAt that Date.parse cannot accept", () => {
    expectInvalid(JSON.stringify(validJson({ createdAt: "not a date" })));
  });
});

describe("parseRepoConfig: kdf bounds", () => {
  it("rejects memoryKiB below the minimum", () => {
    expectInvalid(
      JSON.stringify(validKdfJson({ memoryKiB: KDF_LIMITS.minMemoryKiB - 1 })),
    );
  });

  it("rejects memoryKiB above the maximum", () => {
    expectInvalid(
      JSON.stringify(validKdfJson({ memoryKiB: KDF_LIMITS.maxMemoryKiB + 1 })),
    );
  });

  it("rejects iterations below the minimum", () => {
    expectInvalid(
      JSON.stringify(
        validKdfJson({ iterations: KDF_LIMITS.minIterations - 1 }),
      ),
    );
  });

  it("rejects iterations above the maximum", () => {
    expectInvalid(
      JSON.stringify(
        validKdfJson({ iterations: KDF_LIMITS.maxIterations + 1 }),
      ),
    );
  });

  it("rejects parallelism below the minimum", () => {
    expectInvalid(
      JSON.stringify(
        validKdfJson({ parallelism: KDF_LIMITS.minParallelism - 1 }),
      ),
    );
  });

  it("rejects parallelism above memoryKiB / 8", () => {
    const memoryKiB = KDF_LIMITS.minMemoryKiB;
    const maxParallelism = Math.floor(memoryKiB / 8);
    expectInvalid(
      JSON.stringify(
        validKdfJson({ memoryKiB, parallelism: maxParallelism + 1 }),
      ),
    );
  });

  it("accepts parallelism exactly at memoryKiB / 8", () => {
    const memoryKiB = KDF_LIMITS.minMemoryKiB;
    const maxParallelism = Math.floor(memoryKiB / 8);
    const result = parseRepoConfig(
      JSON.stringify(validKdfJson({ memoryKiB, parallelism: maxParallelism })),
    );
    expect(result.kind).toBe("valid");
  });

  it("rejects a salt of 15 bytes", () => {
    const salt = Uint8Array.from({ length: 15 }, (_, i) => i);
    expectInvalid(JSON.stringify(validKdfJson({ salt: toBase64(salt) })));
  });

  it("rejects a salt of 17 bytes", () => {
    const salt = Uint8Array.from({ length: 17 }, (_, i) => i);
    expectInvalid(JSON.stringify(validKdfJson({ salt: toBase64(salt) })));
  });
});
