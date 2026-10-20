export interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

const REPLACEMENT = 0xfffd;

export class TextEncoder {
  readonly encoding = "utf-8";

  encode(input: string = ""): Uint8Array {
    const text = String(input);
    const out: number[] = [];
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i++;
        } else {
          code = REPLACEMENT;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        code = REPLACEMENT;
      }
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        out.push(
          0xe0 | (code >> 12),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
      } else {
        out.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
      }
    }
    return Uint8Array.from(out);
  }
}

function toBytes(input: unknown): Uint8Array {
  if (input === undefined) return new Uint8Array(0);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError("The provided value is not a buffer source");
}

export class TextDecoder {
  readonly encoding = "utf-8";
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;

  constructor(label: string = "utf-8", options: TextDecoderOptions = {}) {
    const normalized = String(label).trim().toLowerCase();
    if (normalized !== "utf-8" && normalized !== "utf8") {
      throw new RangeError("Only the utf-8 encoding is supported");
    }
    this.fatal = Boolean(options.fatal);
    this.ignoreBOM = Boolean(options.ignoreBOM);
  }

  decode(input?: ArrayBuffer | ArrayBufferView): string {
    const bytes = toBytes(input);
    const codePoints: number[] = [];
    let needed = 0;
    let seen = 0;
    let code = 0;
    let lower = 0x80;
    let upper = 0xbf;

    const fail = () => {
      if (this.fatal) throw new TypeError("The encoded data was not valid");
      codePoints.push(REPLACEMENT);
    };

    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]!;
      if (needed === 0) {
        if (byte <= 0x7f) {
          codePoints.push(byte);
        } else if (byte >= 0xc2 && byte <= 0xdf) {
          needed = 1;
          code = byte & 0x1f;
        } else if (byte >= 0xe0 && byte <= 0xef) {
          if (byte === 0xe0) lower = 0xa0;
          if (byte === 0xed) upper = 0x9f;
          needed = 2;
          code = byte & 0xf;
        } else if (byte >= 0xf0 && byte <= 0xf4) {
          if (byte === 0xf0) lower = 0x90;
          if (byte === 0xf4) upper = 0x8f;
          needed = 3;
          code = byte & 0x7;
        } else {
          fail();
        }
        continue;
      }
      if (byte < lower || byte > upper) {
        code = 0;
        needed = 0;
        seen = 0;
        lower = 0x80;
        upper = 0xbf;
        fail();
        i--;
        continue;
      }
      lower = 0x80;
      upper = 0xbf;
      code = (code << 6) | (byte & 0x3f);
      seen++;
      if (seen === needed) {
        codePoints.push(code);
        code = 0;
        needed = 0;
        seen = 0;
      }
    }
    if (needed !== 0) fail();

    if (!this.ignoreBOM && codePoints[0] === 0xfeff) codePoints.shift();

    let result = "";
    for (let i = 0; i < codePoints.length; i += 4096) {
      result += String.fromCodePoint(...codePoints.slice(i, i + 4096));
    }
    return result;
  }
}
