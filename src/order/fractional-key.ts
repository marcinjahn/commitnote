// A key is the digits of a fraction in (0, 1), in this base-62 alphabet whose
// characters sort in code-unit order. Keys never end in the zero digit, so
// there is always room for a key below any other.
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
const ZERO = DIGITS[0];
const VALID_KEY = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

export function isValidKey(key: string): boolean {
  return VALID_KEY.test(key);
}

export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function midpoint(low: string, high: string | null): string {
  if (high !== null) {
    let common = 0;
    while ((low[common] ?? ZERO) === high[common]) common++;
    if (common > 0) {
      return (
        high.slice(0, common) + midpoint(low.slice(common), high.slice(common))
      );
    }
  }
  const lowDigit = low === "" ? 0 : DIGITS.indexOf(low[0]);
  const highDigit = high === null ? BASE : DIGITS.indexOf(high[0]);
  if (highDigit - lowDigit > 1) {
    return DIGITS[Math.round((lowDigit + highDigit) / 2)];
  }
  if (high !== null && high.length > 1) return high.slice(0, 1);
  return DIGITS[lowDigit] + midpoint(low.slice(1), null);
}

/** A key sorting strictly between `before` and `after`; null means unbounded. */
export function keyBetween(
  before: string | null,
  after: string | null,
): string {
  if (before !== null && !isValidKey(before)) {
    throw new RangeError("Invalid order key");
  }
  if (after !== null && !isValidKey(after)) {
    throw new RangeError("Invalid order key");
  }
  if (before !== null && after !== null && compareKeys(before, after) >= 0) {
    throw new RangeError("Order keys are not ascending");
  }
  return midpoint(before ?? "", after);
}

/** `count` ascending keys between `before` and `after`, kept short by bisecting. */
export function keysBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  if (count <= 0) return [];
  const middle = Math.floor(count / 2);
  const key = keyBetween(before, after);
  return [
    ...keysBetween(before, key, middle),
    key,
    ...keysBetween(key, after, count - middle - 1),
  ];
}
