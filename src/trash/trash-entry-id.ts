import { type RandomSource, secureRandom } from "../crypto/random";

export interface ParsedTrashEntryId {
  readonly deletedAt: number;
  readonly depth: number;
}

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const RANDOM_CHARS = 8;
const RANDOM_BYTES = 5;

const ENTRY_ID_PATTERN =
  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([1-9]\d{0,3})-([a-z2-7]{8})$/;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  return (
    pad(date.getUTCFullYear(), 4) +
    pad(date.getUTCMonth() + 1, 2) +
    pad(date.getUTCDate(), 2) +
    "T" +
    pad(date.getUTCHours(), 2) +
    pad(date.getUTCMinutes(), 2) +
    pad(date.getUTCSeconds(), 2) +
    "Z"
  );
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return output;
}

export function createTrashEntryId(
  now: number,
  depth: number,
  random: RandomSource = secureRandom,
): string {
  if (!Number.isInteger(depth) || depth < 1 || depth > 9999) {
    throw new RangeError("Trash entry depth must be an integer from 1 to 9999");
  }
  const year = new Date(now).getUTCFullYear();
  if (!Number.isFinite(now) || year < 0 || year > 9999) {
    throw new RangeError("Trash entry time is out of range");
  }
  const suffix = encodeBase32(random(RANDOM_BYTES));
  if (suffix.length !== RANDOM_CHARS) {
    throw new RangeError("Random source returned the wrong number of bytes");
  }
  return `${formatTimestamp(now)}-${depth}-${suffix}`;
}

export function parseTrashEntryId(id: string): ParsedTrashEntryId | null {
  const match = ENTRY_ID_PATTERN.exec(id);
  if (match === null) return null;
  const [year, month, day, hours, minutes, seconds] = match
    .slice(1, 7)
    .map(Number);
  const deletedAt = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const date = new Date(deletedAt);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hours ||
    date.getUTCMinutes() !== minutes ||
    date.getUTCSeconds() !== seconds
  ) {
    return null;
  }
  return { deletedAt, depth: Number(match[7]) };
}

/** The same entry id, re-encoded for an item at a different depth. */
export function withTrashEntryDepth(id: string, depth: number): string {
  const match = ENTRY_ID_PATTERN.exec(id);
  if (match === null) throw new RangeError("Invalid trash entry id");
  if (!Number.isInteger(depth) || depth < 1 || depth > 9999) {
    throw new RangeError("Trash entry depth must be an integer from 1 to 9999");
  }
  return id.replace(/-\d+-(?=[a-z2-7]{8}$)/, `-${depth}-`);
}
