import { argon2idDirect, type Argon2idFunction } from "../argon2";
import { deriveKeyring, type Keyring } from "../keyring";
import type { KdfParams } from "../repo-config";

export const REDUCED_KDF: Pick<
  KdfParams,
  "memoryKiB" | "iterations" | "parallelism"
> = {
  memoryKiB: 64,
  iterations: 1,
  parallelism: 1,
};

export function testSalt(byte: number): Uint8Array {
  return Uint8Array.from({ length: 16 }, () => byte);
}

export function testKeyring(
  passphrase = "correct horse battery staple",
  saltByte = 7,
): Promise<Keyring> {
  return deriveKeyring(
    passphrase,
    { algorithm: "argon2id", ...REDUCED_KDF, salt: testSalt(saltByte) },
    argon2idDirect,
  );
}

/** Cheap stand-in for Argon2id; only the key schedule above it matters here. */
export const fastArgon2id: Argon2idFunction = async ({ password, salt }) => {
  const input = new Uint8Array(password.length + salt.length);
  input.set(password, 0);
  input.set(salt, password.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
};
