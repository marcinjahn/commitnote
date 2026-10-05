import type { Argon2idFunction, Argon2idInput } from "../argon2";
import { fromBase64, toBase64 } from "../base64";

export interface MemoizedArgon2idOptions {
  readonly seed?: Iterable<readonly [key: string, hashBase64: string]>;
  readonly onDerived?: (key: string, hashBase64: string) => void;
}

export function argon2idCacheKey(input: Argon2idInput): string {
  return `${toBase64(input.password)}:${toBase64(input.salt)}:${input.memoryKiB}:${input.iterations}:${input.parallelism}`;
}

/** Resolves with a fresh copy every time, because callers zero the hash they get. */
export function memoizedArgon2id(
  inner: Argon2idFunction,
  options: MemoizedArgon2idOptions = {},
): Argon2idFunction {
  const memo = new Map<string, Promise<Uint8Array>>();
  for (const [key, hashBase64] of options.seed ?? []) {
    memo.set(key, Promise.resolve(fromBase64(hashBase64)));
  }

  return async (input) => {
    const key = argon2idCacheKey(input);
    let pending = memo.get(key);
    if (pending === undefined) {
      const derived = inner(input).then((hash) => {
        const own = hash.slice();
        options.onDerived?.(key, toBase64(own));
        return own;
      });
      pending = derived;
      memo.set(key, derived);
      derived.catch(() => {
        if (memo.get(key) === derived) memo.delete(key);
      });
    }
    return (await pending).slice();
  };
}
