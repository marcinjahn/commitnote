// Strict base64 / base64url codecs. Decoding rejects anything that is not the
// unique canonical encoding of some byte sequence (wrong alphabet, wrong
// padding, whitespace, or non-canonical trailing bits), so a tampered config
// value can never be silently coerced into different bytes.

const STANDARD_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})?$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !STANDARD_RE.test(text)) {
    throw new Error(
      "Invalid base64: not the standard alphabet with correct padding",
    );
  }
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new Error("Invalid base64: cannot decode");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (toBase64(bytes) !== text) {
    throw new Error("Invalid base64: not the canonical encoding");
  }
  return bytes;
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  if (text.length % 4 === 1 || !BASE64URL_RE.test(text)) {
    throw new Error(
      "Invalid base64url: not the URL-safe alphabet, or wrong length",
    );
  }
  const paddingLength = (4 - (text.length % 4)) % 4;
  const standard =
    text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(paddingLength);
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(standard);
  } catch {
    throw new Error("Invalid base64url: cannot decode");
  }
  if (toBase64Url(bytes) !== text) {
    throw new Error("Invalid base64url: not the canonical encoding");
  }
  return bytes;
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
