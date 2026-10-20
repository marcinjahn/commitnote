const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function invalidCharacter(message: string): Error {
  const error = new Error(message);
  error.name = "InvalidCharacterError";
  return error;
}

export function btoa(data: unknown): string {
  const input = String(data);
  let out = "";
  for (let i = 0; i < input.length; i += 3) {
    const codes = [0, 1, 2].map((offset) =>
      i + offset < input.length ? input.charCodeAt(i + offset) : -1,
    );
    if (codes.some((code) => code > 0xff)) {
      throw invalidCharacter("The string contains characters outside Latin-1");
    }
    const [a, b, c] = codes as [number, number, number];
    const triple = (a << 16) | ((b < 0 ? 0 : b) << 8) | (c < 0 ? 0 : c);
    out += ALPHABET[(triple >> 18) & 63]!;
    out += ALPHABET[(triple >> 12) & 63]!;
    out += b < 0 ? "=" : ALPHABET[(triple >> 6) & 63]!;
    out += c < 0 ? "=" : ALPHABET[triple & 63]!;
  }
  return out;
}

export function atob(data: unknown): string {
  let input = String(data).replace(/[\t\n\f\r ]/g, "");
  if (input.length % 4 === 0) input = input.replace(/==?$/, "");
  if (input.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(input)) {
    throw invalidCharacter("The string is not correctly encoded");
  }
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const char of input) {
    buffer = (buffer << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return out;
}
