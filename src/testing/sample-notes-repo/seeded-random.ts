import type { RandomSource } from "../../crypto/random";

/** mulberry32: a small, deterministic 32-bit PRNG, used only to make the fixture reproducible. */
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;

  function nextUint32(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  return (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 4) {
      const value = nextUint32();
      bytes[i] = value & 0xff;
      if (i + 1 < length) bytes[i + 1] = (value >>> 8) & 0xff;
      if (i + 2 < length) bytes[i + 2] = (value >>> 16) & 0xff;
      if (i + 3 < length) bytes[i + 3] = (value >>> 24) & 0xff;
    }
    return bytes;
  };
}
