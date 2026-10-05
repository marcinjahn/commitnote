import { describe, expect, it, vi } from "vitest";
import type { Argon2idFunction, Argon2idInput } from "../argon2";
import { toBase64 } from "../base64";
import { argon2idCacheKey, memoizedArgon2id } from "./memoized-argon2id";

const encoder = new TextEncoder();

const INPUT: Argon2idInput = {
  password: encoder.encode("passphrase"),
  salt: new Uint8Array(16).fill(7),
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 1,
};

async function fakeHash(input: Argon2idInput): Promise<Uint8Array> {
  const text = argon2idCacheKey(input);
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(text)),
  );
}

function countingInner() {
  return vi.fn<Argon2idFunction>(fakeHash);
}

describe("argon2idCacheKey", () => {
  it("joins every input field", () => {
    expect(argon2idCacheKey(INPUT)).toBe(
      `${toBase64(INPUT.password)}:${toBase64(INPUT.salt)}:65536:3:1`,
    );
  });
});

describe("memoizedArgon2id", () => {
  it("derives the same input once and returns equal bytes", async () => {
    const inner = countingInner();
    const argon2id = memoizedArgon2id(inner);

    const first = await argon2id(INPUT);
    const second = await argon2id({ ...INPUT });

    expect(second).toEqual(first);
    expect(first).toEqual(await fakeHash(INPUT));
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Partial<Argon2idInput>]>([
    ["password", { password: encoder.encode("another passphrase") }],
    ["salt", { salt: new Uint8Array(16).fill(8) }],
    ["memoryKiB", { memoryKiB: 131072 }],
    ["iterations", { iterations: 4 }],
    ["parallelism", { parallelism: 2 }],
  ])("a different %s derives again", async (_field, change) => {
    const inner = countingInner();
    const argon2id = memoizedArgon2id(inner);
    const other = { ...INPUT, ...change };

    const first = await argon2id(INPUT);
    const second = await argon2id(other);

    expect(inner).toHaveBeenCalledTimes(2);
    expect(second).toEqual(await fakeHash(other));
    expect(second).not.toEqual(first);
  });

  it("zeroing a returned hash does not change the next result", async () => {
    const argon2id = memoizedArgon2id(countingInner());

    const first = await argon2id(INPUT);
    const expected = first.slice();
    first.fill(0);

    expect(await argon2id(INPUT)).toEqual(expected);
  });

  it("zeroing the hash inner returned does not change later results", async () => {
    let returned: Uint8Array | undefined;
    const argon2id = memoizedArgon2id(async (input) => {
      returned = await fakeHash(input);
      return returned;
    });

    const first = await argon2id(INPUT);
    const expected = first.slice();
    returned?.fill(0);

    expect(await argon2id(INPUT)).toEqual(expected);
  });

  it("seeded keys never call inner or onDerived", async () => {
    const inner = countingInner();
    const onDerived = vi.fn();
    const seeded = new Uint8Array(32).fill(9);
    const argon2id = memoizedArgon2id(inner, {
      seed: [[argon2idCacheKey(INPUT), toBase64(seeded)]],
      onDerived,
    });

    expect(await argon2id(INPUT)).toEqual(seeded);
    expect(await argon2id(INPUT)).toEqual(seeded);
    expect(inner).not.toHaveBeenCalled();
    expect(onDerived).not.toHaveBeenCalled();
  });

  it("reports each new key and its base64 hash once", async () => {
    const onDerived = vi.fn();
    const argon2id = memoizedArgon2id(countingInner(), { onDerived });
    const other = { ...INPUT, iterations: 4 };

    await argon2id(INPUT);
    await argon2id(INPUT);
    await argon2id(other);

    expect(onDerived.mock.calls).toEqual([
      [argon2idCacheKey(INPUT), toBase64(await fakeHash(INPUT))],
      [argon2idCacheKey(other), toBase64(await fakeHash(other))],
    ]);
  });

  it("concurrent calls with the same input share one derivation", async () => {
    const inner = countingInner();
    const argon2id = memoizedArgon2id(inner);

    const [first, second] = await Promise.all([
      argon2id(INPUT),
      argon2id(INPUT),
    ]);

    expect(inner).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("a failed derivation is not cached", async () => {
    const inner = vi
      .fn<Argon2idFunction>(fakeHash)
      .mockRejectedValueOnce(new Error("worker crashed"));
    const onDerived = vi.fn();
    const argon2id = memoizedArgon2id(inner, { onDerived });

    await expect(argon2id(INPUT)).rejects.toThrow("worker crashed");
    expect(await argon2id(INPUT)).toEqual(await fakeHash(INPUT));
    expect(inner).toHaveBeenCalledTimes(2);
    expect(onDerived).toHaveBeenCalledTimes(1);
  });
});
