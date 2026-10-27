import type { HostCrypto } from "../host-services";

interface Argon2idInput {
  readonly password: Uint8Array;
  readonly salt: Uint8Array;
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
}

type Argon2idFunction = (input: Argon2idInput) => Promise<Uint8Array>;

export type { Argon2idFunction, Argon2idInput };

const HASH_LENGTH = 32;

let boundCrypto: HostCrypto | undefined;

export function bindHostArgon2(crypto: HostCrypto): void {
  boundCrypto = crypto;
}

export function hostArgon2id(crypto: HostCrypto): Argon2idFunction {
  return async (input) => {
    const hash = await crypto.argon2id({
      password: input.password,
      salt: input.salt,
      memoryKiB: input.memoryKiB,
      iterations: input.iterations,
      parallelism: input.parallelism,
      hashLength: HASH_LENGTH,
    });
    if (hash.length !== HASH_LENGTH) {
      throw new Error("Host Argon2id returned the wrong hash length");
    }
    const copy = new Uint8Array(HASH_LENGTH);
    copy.set(hash);
    return copy;
  };
}

const boundArgon2id: Argon2idFunction = (input) =>
  boundCrypto === undefined
    ? Promise.reject(new Error("Argon2id used before host crypto was bound"))
    : hostArgon2id(boundCrypto)(input);

export const argon2idDirect: Argon2idFunction = boundArgon2id;
export const argon2idInWorker: Argon2idFunction = boundArgon2id;
