import { describe, expect, it } from "vitest";
import { argon2idDirect } from "./argon2";
import { computeKeyCheck, deriveKeyring } from "./keyring";
import { decryptName, encryptName, encryptPath } from "./name-cipher";
import { decryptNote, encryptNote } from "./note-cipher";
import type { KdfParams } from "./repo-config";

// Known-answer vectors for format v1, pinned against literals computed by an
// independent node:crypto script (argon2Sync + hkdfSync + createHmac +
// createCipheriv), not against this app's own output. If these ever fail,
// the app's implementation is wrong, not the literals.

const PASSPHRASE = "commitnote known answer";
const SALT = Uint8Array.from({ length: 16 }, (_, i) => i); // 0x00..0x0f

function kdf(
  overrides: Pick<KdfParams, "memoryKiB" | "iterations" | "parallelism">,
): KdfParams {
  return { algorithm: "argon2id", salt: SALT, ...overrides };
}

describe("known-answer vectors (format v1)", () => {
  describe("vector set A (reduced params: memoryKiB=1024, iterations=1, parallelism=1)", () => {
    const kdfA = kdf({ memoryKiB: 1024, iterations: 1, parallelism: 1 });

    it("matches the pinned key check", async () => {
      const keyring = await deriveKeyring(PASSPHRASE, kdfA, argon2idDirect);
      expect(await computeKeyCheck(keyring)).toBe(
        "Fwgxw4kavCNV6MMT02X5Wx8gjuC5vuoOCV9+6uo7Fbc=",
      );
    });

    it("matches the pinned encrypted name for 'Projects'", async () => {
      const keyring = await deriveKeyring(PASSPHRASE, kdfA, argon2idDirect);
      const encrypted = await encryptName(keyring, "Projects");
      expect(encrypted).toBe(
        "yPLu39QkVKbk49JHrV-ynCW3SVRZxK7zkHve0ofoHzy1WXyy",
      );
      expect(await decryptName(keyring, encrypted)).toBe("Projects");
    });

    it("matches the pinned encrypted name for 'Zażółć gęślą jaźń'", async () => {
      const keyring = await deriveKeyring(PASSPHRASE, kdfA, argon2idDirect);
      const encrypted = await encryptName(keyring, "Zażółć gęślą jaźń");
      expect(encrypted).toBe(
        "9s-OyrV4-2oilTBQn2cgM0agia7r3Xp18bPbwJjCTS6y0L33sFZzD5RbuJt4dZvGM9vIfpQe",
      );
      expect(await decryptName(keyring, encrypted)).toBe("Zażółć gęślą jaźń");
    });

    it("matches the pinned encrypted path", async () => {
      const keyring = await deriveKeyring(PASSPHRASE, kdfA, argon2idDirect);
      const encrypted = await encryptPath(keyring, [
        "Projects",
        "commitnote",
        "Ideas",
      ]);
      expect(encrypted).toBe(
        "yPLu39QkVKbk49JHrV-ynCW3SVRZxK7zkHve0ofoHzy1WXyy/cYt9sdtJT8xAhnnKzS_kpiIBj7n4oAGLCM6QhhZsbugPgLl_mAU/3SutLemgp6ja5VtAeZljHBPySNOHH02pO5OVgzqpcXM9",
      );
    });

    it("matches the pinned encrypted note", async () => {
      const keyring = await deriveKeyring(PASSPHRASE, kdfA, argon2idDirect);
      const noteIvBytes = Uint8Array.from({ length: 12 }, (_, i) => 0x10 + i); // 0x10..0x1b
      const random = (length: number): Uint8Array => {
        expect(length).toBe(noteIvBytes.length);
        return noteIvBytes;
      };
      const markdown = "# Hello\n\n- [ ] task\n";
      const encrypted = await encryptNote(keyring, markdown, random);
      expect(encrypted).toBe(
        "v1:EBESExQVFhcYGRobV0RqAJINWc4SuhnwwhVtVLgsDpxszl4twB0GmbWmbIlPN++j",
      );
      expect(await decryptNote(keyring, encrypted)).toBe(markdown);
    });
  });

  describe("vector set B (real defaults: memoryKiB=65536, iterations=3, parallelism=1)", () => {
    it("matches the pinned key check", async () => {
      const keyring = await deriveKeyring(
        PASSPHRASE,
        kdf({ memoryKiB: 65536, iterations: 3, parallelism: 1 }),
        argon2idDirect,
      );
      expect(await computeKeyCheck(keyring)).toBe(
        "WgUuEkO4WJjQFMU5eGhGmNL9wAuFfycTjIbYTbIYsX0=",
      );
    });
  });
});
