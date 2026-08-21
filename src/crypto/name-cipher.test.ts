import { describe, expect, it } from "vitest";
import { MAX_NAME_BYTES, NAME_AAD } from "../format/v1";
import { argon2idDirect } from "./argon2";
import { fromBase64Url, toBase64Url } from "./base64";
import { deriveKeyring, type Keyring } from "./keyring";
import {
  decryptName,
  decryptPath,
  encryptName,
  encryptPath,
} from "./name-cipher";
import type { KdfParams } from "./repo-config";

const REDUCED_KDF: Pick<KdfParams, "memoryKiB" | "iterations" | "parallelism"> =
  {
    memoryKiB: 64,
    iterations: 1,
    parallelism: 1,
  };

function salt(byte: number): Uint8Array {
  return Uint8Array.from({ length: 16 }, () => byte);
}

async function keyring(
  passphrase = "correct horse battery staple",
): Promise<Keyring> {
  return deriveKeyring(
    passphrase,
    { algorithm: "argon2id", ...REDUCED_KDF, salt: salt(1) },
    argon2idDirect,
  );
}

describe("encryptName / decryptName", () => {
  it("round-trips a name", async () => {
    const kr = await keyring();
    const segment = await encryptName(kr, "Projects");
    expect(await decryptName(kr, segment)).toBe("Projects");
  });

  it("is deterministic: same input yields the same stored segment", async () => {
    const kr = await keyring();
    const a = await encryptName(kr, "Ideas");
    const b = await encryptName(kr, "Ideas");
    expect(a).toBe(b);
  });

  it("NFD input encrypts to the same segment as NFC input", async () => {
    const kr = await keyring();
    const nfc = "café"; // "café", precomposed
    const nfd = "café"; // "e" + combining acute accent
    expect(nfc.normalize("NFC")).not.toBe(nfd);
    const a = await encryptName(kr, nfc);
    const b = await encryptName(kr, nfd);
    expect(a).toBe(b);
    expect(await decryptName(kr, a)).toBe(nfc);
  });

  it("accepts a 150-byte name and yields a stored segment of at most 238 characters", async () => {
    const kr = await keyring();
    const name = "a".repeat(MAX_NAME_BYTES);
    const segment = await encryptName(kr, name);
    expect(segment.length).toBeLessThanOrEqual(238);
    expect(await decryptName(kr, segment)).toBe(name);
  });

  it("throws RangeError for a 151-byte name", async () => {
    const kr = await keyring();
    await expect(
      encryptName(kr, "a".repeat(MAX_NAME_BYTES + 1)),
    ).rejects.toThrow(RangeError);
  });

  it("throws RangeError for an empty name", async () => {
    const kr = await keyring();
    await expect(encryptName(kr, "")).rejects.toThrow(RangeError);
  });

  it("returns null for a plaintext filename like README.md", async () => {
    const kr = await keyring();
    expect(await decryptName(kr, "README.md")).toBeNull();
  });

  it("returns null for .keep", async () => {
    const kr = await keyring();
    expect(await decryptName(kr, ".keep")).toBeNull();
  });

  it("returns null for .commitnote", async () => {
    const kr = await keyring();
    expect(await decryptName(kr, ".commitnote")).toBeNull();
  });

  it("returns null for a truncated segment", async () => {
    const kr = await keyring();
    const segment = await encryptName(kr, "Projects");
    expect(await decryptName(kr, segment.slice(0, 10))).toBeNull();
  });

  it("returns null for a segment encrypted with a different keyring", async () => {
    const kr = await keyring("correct horse battery staple");
    const other = await keyring("a different passphrase");
    const segment = await encryptName(kr, "Projects");
    expect(await decryptName(other, segment)).toBeNull();
  });

  it("returns null when the ciphertext is valid but the IV was swapped for another valid name's IV", async () => {
    const kr = await keyring();
    const segmentA = await encryptName(kr, "Projects");
    const ivForProjects = fromBase64Url(segmentA).slice(0, 12);

    // Build a GCM ciphertext for "Ideas" that genuinely authenticates under
    // "Projects"'s IV, so the tag alone cannot distinguish it from a real
    // segment: only the deterministic-IV recheck can.
    const ideasBytes = new TextEncoder().encode("Ideas");
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: ivForProjects,
        additionalData: new TextEncoder().encode(NAME_AAD),
      },
      kr.nameKey,
      ideasBytes,
    );
    const combined = new Uint8Array(
      ivForProjects.length + ciphertext.byteLength,
    );
    combined.set(ivForProjects, 0);
    combined.set(new Uint8Array(ciphertext), ivForProjects.length);

    expect(await decryptName(kr, toBase64Url(combined))).toBeNull();
  });
});

describe("encryptPath / decryptPath", () => {
  it("round-trips a multi-segment path", async () => {
    const kr = await keyring();
    const path = ["Projects", "commitnote", "Ideas"];
    const stored = await encryptPath(kr, path);
    expect(await decryptPath(kr, stored)).toEqual(path);
  });

  it("maps the empty path to the empty string and back", async () => {
    const kr = await keyring();
    expect(await encryptPath(kr, [])).toBe("");
    expect(await decryptPath(kr, "")).toEqual([]);
  });

  it("returns null if any segment is foreign", async () => {
    const kr = await keyring();
    const segment = await encryptName(kr, "Projects");
    const stored = `${segment}/README.md`;
    expect(await decryptPath(kr, stored)).toBeNull();
  });
});
