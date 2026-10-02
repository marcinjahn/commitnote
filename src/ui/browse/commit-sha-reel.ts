export const HEX_DIGITS = "0123456789ABCDEF";

export const MAX_ROLL_MS = 2_000;
const MIN_ROLL_MS = 400;

export function digitIndex(char: string): number {
  return HEX_DIGITS.indexOf(char.toUpperCase());
}

/** How long one character takes to roll from `from` to `to`, through every digit between. */
export function rollDurationMs(from: string, to: string): number {
  const start = digitIndex(from);
  const end = digitIndex(to);
  if (start < 0 || end < 0 || start === end) return 0;
  const steps = Math.abs(end - start);
  return (
    MIN_ROLL_MS +
    ((MAX_ROLL_MS - MIN_ROLL_MS) * (steps - 1)) / (HEX_DIGITS.length - 2)
  );
}
