import { describe, expect, it } from "vitest";
import { NOTE_PREFIX } from "../format/v1";
import { fromBase64, toBase64 } from "./base64";
import type { Keyring } from "./keyring";
import { decryptNote, encryptNote, NoteDecryptionError } from "./note-cipher";
import { testKeyring } from "./testing/test-keyring";

function keyring(passphrase?: string): Promise<Keyring> {
  return testKeyring(passphrase, 1);
}

describe("encryptNote / decryptNote", () => {
  it("round-trips an empty string", async () => {
    const kr = await keyring();
    const stored = await encryptNote(kr, "");
    expect(await decryptNote(kr, stored)).toBe("");
  });

  it("round-trips unicode text", async () => {
    const kr = await keyring();
    const markdown = "# Zażółć gęślą jaźń\n\n- [x] 日本語のノート 🎉\n";
    const stored = await encryptNote(kr, markdown);
    expect(await decryptNote(kr, stored)).toBe(markdown);
  });

  it("round-trips large text", async () => {
    const kr = await keyring();
    const markdown = "line of text\n".repeat(5000);
    const stored = await encryptNote(kr, markdown);
    expect(await decryptNote(kr, stored)).toBe(markdown);
  });

  it("produces a different stored value each time but both decrypt", async () => {
    const kr = await keyring();
    const markdown = "same content";
    const a = await encryptNote(kr, markdown);
    const b = await encryptNote(kr, markdown);
    expect(a).not.toBe(b);
    expect(await decryptNote(kr, a)).toBe(markdown);
    expect(await decryptNote(kr, b)).toBe(markdown);
  });

  it("starts with the v1 note prefix", async () => {
    const kr = await keyring();
    const stored = await encryptNote(kr, "hello");
    expect(stored.startsWith(NOTE_PREFIX)).toBe(true);
  });

  it("throws NoteDecryptionError when the prefix is missing", async () => {
    const kr = await keyring();
    await expect(decryptNote(kr, "not-a-stored-note")).rejects.toThrow(
      NoteDecryptionError,
    );
  });

  it("throws NoteDecryptionError on invalid base64 after the prefix", async () => {
    const kr = await keyring();
    await expect(decryptNote(kr, `${NOTE_PREFIX}not base64!!`)).rejects.toThrow(
      NoteDecryptionError,
    );
  });

  it("throws NoteDecryptionError when the stored payload is too short", async () => {
    const kr = await keyring();
    const stored = NOTE_PREFIX + toBase64(new Uint8Array(10));
    await expect(decryptNote(kr, stored)).rejects.toThrow(NoteDecryptionError);
  });

  it("throws NoteDecryptionError when the ciphertext is tampered", async () => {
    const kr = await keyring();
    const stored = await encryptNote(kr, "hello world");
    const bytes = fromBase64(stored.slice(NOTE_PREFIX.length));
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = NOTE_PREFIX + toBase64(bytes);
    await expect(decryptNote(kr, tampered)).rejects.toThrow(
      NoteDecryptionError,
    );
  });

  it("throws NoteDecryptionError when the IV is tampered", async () => {
    const kr = await keyring();
    const stored = await encryptNote(kr, "hello world");
    const bytes = fromBase64(stored.slice(NOTE_PREFIX.length));
    bytes[0] ^= 0xff;
    const tampered = NOTE_PREFIX + toBase64(bytes);
    await expect(decryptNote(kr, tampered)).rejects.toThrow(
      NoteDecryptionError,
    );
  });

  it("throws NoteDecryptionError when decrypting with the wrong keyring", async () => {
    const kr = await keyring("correct horse battery staple");
    const other = await keyring("a different passphrase");
    const stored = await encryptNote(kr, "hello world");
    await expect(decryptNote(other, stored)).rejects.toThrow(
      NoteDecryptionError,
    );
  });
});
