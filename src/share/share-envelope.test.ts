import { describe, expect, it } from "vitest";
import { argon2idDirect, type Argon2idFunction } from "../crypto/argon2";
import { fromBase64Url, toBase64Url } from "../crypto/base64";
import { KDF_LIMITS } from "../format/v1";
import {
  SHARE_ENVELOPE_MAX_BYTES,
  ShareOpenError,
  envelopeNeedsPassword,
  openShare,
  sealShare,
  type ShareOpenErrorKind,
} from "./share-envelope";

const NOTE = {
  name: "Known answer",
  markdown: "# Hello\n",
  sharedAt: "2026-01-02T03:04:05.000Z",
};

function sequentialRandom() {
  const bytes = Uint8Array.from({ length: 60 }, (_, i) => i);
  let offset = 0;
  return (length: number) => {
    const out = bytes.slice(offset, offset + length);
    offset += length;
    return out;
  };
}

function spyArgon2() {
  const cache = new Map<string, Promise<Uint8Array>>();
  const spy = {
    calls: 0,
    fn: ((input) => {
      spy.calls++;
      const key = JSON.stringify([
        Array.from(input.password),
        Array.from(input.salt),
        input.memoryKiB,
        input.iterations,
        input.parallelism,
      ]);
      let result = cache.get(key);
      if (!result) {
        result = argon2idDirect(input);
        cache.set(key, result);
      }
      return result.then((hash) => hash.slice());
    }) as Argon2idFunction,
  };
  return spy;
}

const argon2 = spyArgon2();

async function seal(password?: string) {
  const result = await sealShare({
    ...NOTE,
    password,
    random: sequentialRandom(),
    argon2id: argon2.fn,
  });
  if (result.kind !== "sealed") {
    throw new Error("expected sealed");
  }
  return result;
}

async function openKind(
  envelope: string,
  linkSecret: string,
  password?: string,
): Promise<ShareOpenErrorKind | "opened"> {
  try {
    await openShare(envelope, linkSecret, password, argon2.fn);
    return "opened";
  } catch (error) {
    if (error instanceof ShareOpenError) {
      return error.kind;
    }
    throw error;
  }
}

function mutate(envelope: string, change: (value: Record<string, unknown>) => void) {
  const value = JSON.parse(envelope) as Record<string, unknown>;
  change(value);
  return JSON.stringify(value);
}

function flipFirstByte(text: string): string {
  const bytes = fromBase64Url(text).slice();
  bytes[0] ^= 1;
  return toBase64Url(bytes);
}

describe("share envelope", () => {
  describe("known-answer vectors", () => {
    // Literals computed independently with node:crypto (argon2Sync, hkdfSync, aes-256-gcm).
    const PLAIN =
      '{"commitnote":"share","v":1,"kdf":null,"salt":"ICEiIyQlJicoKSorLC0uLw","iv":"MDEyMzQ1Njc4OTo7","ct":"6BopCch0QkJDICxWa-R3vSsh-19Z5mc2YDyDjspgHDn2MEFq1Ni99gKNY42LDteKxfNTsuWoPIGovnkITSDKT74trQnlXvzbpgAC9Jev6uNU5_7A9-zCT-6zkyLHz0yF8Yn1tNNtKfSg4w"}';
    const WITH_PASSWORD =
      '{"commitnote":"share","v":1,"kdf":{"alg":"argon2id","memoryKiB":65536,"iterations":3,"parallelism":1},"salt":"ICEiIyQlJicoKSorLC0uLw","iv":"MDEyMzQ1Njc4OTo7","ct":"q8MOF7ZY9FxVXf4C3ej5ZXlnvw1dNQVHenAGVesFJY9soNaqc-uzS9JLCVGH3IKOFRI1oLQ43asT_EkOL7mCbHBIa0PCjxo7eKmJFsKN69I7Nmv5YDwHycSgXXVx3C-tAcH90TRFi-8DCQ"}';

    it("seals and opens a share without a password", async () => {
      const sealed = await seal();
      expect(sealed.envelope).toBe(PLAIN);
      expect(sealed.linkSecret).toBe(toBase64Url(Uint8Array.from({ length: 32 }, (_, i) => i)));
      expect(sealed.linkSecret).toHaveLength(43);
      await expect(openShare(PLAIN, sealed.linkSecret, undefined, argon2.fn)).resolves.toEqual(NOTE);
    });

    it("seals and opens a share with a password", async () => {
      const sealed = await seal("correct horse");
      expect(sealed.envelope).toBe(WITH_PASSWORD);
      await expect(
        openShare(WITH_PASSWORD, sealed.linkSecret, "correct horse", argon2.fn),
      ).resolves.toEqual(NOTE);
    });
  });

  describe("round trips", () => {
    it("treats an empty password as no password", async () => {
      const sealed = await seal("");
      expect(envelopeNeedsPassword(sealed.envelope)).toBe(false);
    });

    it("opens a share without a password and ignores a given password", async () => {
      const sealed = await seal();
      await expect(openShare(sealed.envelope, sealed.linkSecret, "ignored", argon2.fn)).resolves.toEqual(NOTE);
    });

    it("opens NFC and NFD equivalent non-ASCII passwords to the same share", async () => {
      const nfc = "pässwörd é中";
      const nfd = nfc.normalize("NFD");
      expect(nfd).not.toBe(nfc);
      const sealed = await seal(nfc);
      await expect(openShare(sealed.envelope, sealed.linkSecret, nfd, argon2.fn)).resolves.toEqual(NOTE);
    });

    it("preserves non-ASCII note content", async () => {
      const note = { name: "ä中😀", markdown: "a\r\nb\u0000c", sharedAt: "x" };
      const sealed = await sealShare({ ...note, argon2id: argon2.fn });
      if (sealed.kind !== "sealed") throw new Error("expected sealed");
      await expect(openShare(sealed.envelope, sealed.linkSecret, undefined, argon2.fn)).resolves.toEqual(note);
    });
  });

  describe("passwords", () => {
    it("rejects wrong, missing and empty passwords", async () => {
      const sealed = await seal("correct horse");
      expect(envelopeNeedsPassword(sealed.envelope)).toBe(true);
      expect(await openKind(sealed.envelope, sealed.linkSecret, "wrong")).toBe("wrongPassword");
      const before = argon2.calls;
      expect(await openKind(sealed.envelope, sealed.linkSecret)).toBe("passwordRequired");
      expect(await openKind(sealed.envelope, sealed.linkSecret, "")).toBe("passwordRequired");
      expect(argon2.calls).toBe(before);
    });

    it("fails with the right password and a different link secret", async () => {
      const sealed = await seal("correct horse");
      const other = toBase64Url(new Uint8Array(32).fill(7));
      expect(await openKind(sealed.envelope, other, "correct horse")).toBe("wrongPassword");
    });
  });

  describe("tampering", () => {
    it("never opens a no-password share with a changed header, iv or ct", async () => {
      const { envelope, linkSecret } = await seal();
      const variants: Array<(value: Record<string, unknown>) => void> = [
        (v) => (v.salt = flipFirstByte(v.salt as string)),
        (v) => (v.iv = flipFirstByte(v.iv as string)),
        (v) => (v.ct = flipFirstByte(v.ct as string)),
        (v) => {
          const ct = fromBase64Url(v.ct as string).slice();
          ct[ct.length - 1] ^= 1;
          v.ct = toBase64Url(ct);
        },
      ];
      for (const change of variants) {
        expect(await openKind(mutate(envelope, change), linkSecret)).toBe("damaged");
      }
      expect(
        await openKind(
          mutate(envelope, (v) => (v.kdf = { alg: "argon2id", memoryKiB: 65536, iterations: 3, parallelism: 1 })),
          linkSecret,
          "pw",
        ),
      ).toBe("wrongPassword");
      expect(await openKind(mutate(envelope, (v) => (v.v = 2)), linkSecret)).toBe("damaged");
    });

    it("never opens a password share with a removed or changed kdf, or changed salt, iv or ct", async () => {
      const { envelope, linkSecret } = await seal("correct horse");
      expect(await openKind(mutate(envelope, (v) => (v.kdf = null)), linkSecret, "correct horse")).toBe("damaged");
      expect(
        await openKind(
          mutate(envelope, (v) => {
            (v.kdf as Record<string, unknown>).iterations = 4;
          }),
          linkSecret,
          "correct horse",
        ),
      ).toBe("wrongPassword");
      expect(
        await openKind(
          mutate(envelope, (v) => (v.salt = flipFirstByte(v.salt as string))),
          linkSecret,
          "correct horse",
        ),
      ).toBe("wrongPassword");
      expect(
        await openKind(
          mutate(envelope, (v) => (v.iv = flipFirstByte(v.iv as string))),
          linkSecret,
          "correct horse",
        ),
      ).toBe("wrongPassword");
      expect(
        await openKind(
          mutate(envelope, (v) => (v.ct = flipFirstByte(v.ct as string))),
          linkSecret,
          "correct horse",
        ),
      ).toBe("wrongPassword");
    });
  });

  describe("malformed envelopes", () => {
    it("rejects kdf parameters outside the limits without running Argon2", async () => {
      const { envelope, linkSecret } = await seal("correct horse");
      const before = argon2.calls;
      const tooMuchMemory = mutate(envelope, (v) => {
        (v.kdf as Record<string, unknown>).memoryKiB = KDF_LIMITS.maxMemoryKiB + 1;
      });
      const tooManyIterations = mutate(envelope, (v) => {
        (v.kdf as Record<string, unknown>).iterations = KDF_LIMITS.maxIterations + 1;
      });
      expect(await openKind(tooMuchMemory, linkSecret, "correct horse")).toBe("damaged");
      expect(await openKind(tooManyIterations, linkSecret, "correct horse")).toBe("damaged");
      expect(argon2.calls).toBe(before);
    });

    it("reports damaged envelopes and throws from envelopeNeedsPassword", async () => {
      const { envelope, linkSecret } = await seal();
      const damaged = [
        "not json",
        "[]",
        "null",
        mutate(envelope, (v) => (v.commitnote = "other")),
        mutate(envelope, (v) => (v.v = 2)),
        mutate(envelope, (v) => delete v.kdf),
        mutate(envelope, (v) => delete v.salt),
        mutate(envelope, (v) => delete v.iv),
        mutate(envelope, (v) => delete v.ct),
        mutate(envelope, (v) => (v.salt = toBase64Url(new Uint8Array(15)))),
        mutate(envelope, (v) => (v.iv = toBase64Url(new Uint8Array(11)))),
        mutate(envelope, (v) => (v.ct = toBase64Url(new Uint8Array(15)))),
        mutate(envelope, (v) => (v.kdf = { alg: "scrypt", memoryKiB: 65536, iterations: 3, parallelism: 1 })),
        mutate(envelope, (v) => (v.kdf = "argon2id")),
      ];
      for (const text of damaged) {
        expect(await openKind(text, linkSecret)).toBe("damaged");
        expect(() => envelopeNeedsPassword(text)).toThrow(ShareOpenError);
      }
    });

    it("rejects a link secret of the wrong length or alphabet", async () => {
      const { envelope } = await seal();
      expect(await openKind(envelope, toBase64Url(new Uint8Array(31)))).toBe("damaged");
      expect(await openKind(envelope, "!!!")).toBe("damaged");
    });

    it("rejects a plaintext that is not a shared note", async () => {
      const linkSecret = new Uint8Array(32).fill(1);
      const salt = new Uint8Array(16).fill(2);
      const iv = new Uint8Array(12).fill(3);
      const header = JSON.stringify({ v: 1, kdf: null, salt: toBase64Url(salt) });
      const ikm = await crypto.subtle.importKey("raw", linkSecret, "HKDF", false, ["deriveBits"]);
      const keyBytes = await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("commitnote share v1 key") },
        ikm,
        256,
      );
      const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
      const ct = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`commitnote share v1\n${header}`) },
        key,
        new TextEncoder().encode(JSON.stringify({ v: 1, name: "n", markdown: 5, sharedAt: "t" })),
      );
      const envelope = JSON.stringify({
        commitnote: "share",
        v: 1,
        kdf: null,
        salt: toBase64Url(salt),
        iv: toBase64Url(iv),
        ct: toBase64Url(new Uint8Array(ct)),
      });
      expect(await openKind(envelope, toBase64Url(linkSecret))).toBe("damaged");
    });

    it("keeps secrets out of error messages", async () => {
      const sealed = await seal("correct horse");
      const error = await openShare(sealed.envelope, sealed.linkSecret, "zebra-guess", argon2.fn).then(
        () => null,
        (e: Error) => e,
      );
      expect(error).toBeInstanceOf(ShareOpenError);
      expect(error?.message).not.toContain(sealed.linkSecret);
      expect(error?.message).not.toContain("zebra-guess");
    });
  });

  describe("size cap", () => {
    const sealWithMarkdown = (length: number) =>
      sealShare({ ...NOTE, markdown: "a".repeat(length), argon2id: argon2.fn });

    it("returns tooLarge above the cap and seals just under it", async () => {
      const empty = await sealWithMarkdown(0);
      if (empty.kind !== "sealed") throw new Error("expected sealed");
      const maxMarkdown = Math.floor(((SHARE_ENVELOPE_MAX_BYTES - empty.envelope.length) * 3) / 4);

      const under = await sealWithMarkdown(maxMarkdown - 8);
      if (under.kind !== "sealed") throw new Error("expected sealed");
      expect(under.envelope.length).toBeLessThanOrEqual(SHARE_ENVELOPE_MAX_BYTES);
      expect(under.envelope.length).toBeGreaterThan(SHARE_ENVELOPE_MAX_BYTES - 16);

      expect((await sealWithMarkdown(maxMarkdown + 8)).kind).toBe("tooLarge");
    });
  });
});
