export type RandomSource = (length: number) => Uint8Array;

export const secureRandom: RandomSource = (length) =>
  crypto.getRandomValues(new Uint8Array(length));
