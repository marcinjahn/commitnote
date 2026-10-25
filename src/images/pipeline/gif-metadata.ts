const HEADER_LENGTH = 6;
const SCREEN_DESCRIPTOR_LENGTH = 7;
const IMAGE_DESCRIPTOR_LENGTH = 9;
const APPLICATION_IDENTIFIER_LENGTH = 11;
const KEPT_APPLICATIONS = new Set(["NETSCAPE2.0", "ANIMEXTS1.0"]);

const EXTENSION_INTRODUCER = 0x21;
const IMAGE_SEPARATOR = 0x2c;
const TRAILER = 0x3b;
const COMMENT_LABEL = 0xfe;
const APPLICATION_LABEL = 0xff;

function colourTableLength(packed: number): number {
  return packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
}

function subBlocksEnd(bytes: Uint8Array, start: number): number {
  let offset = start;
  for (;;) {
    if (offset >= bytes.length) return -1;
    const size = bytes[offset++];
    if (size === 0) return offset;
    offset += size;
  }
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[offset + i]);
  return text;
}

function isKeptApplication(bytes: Uint8Array, labelEnd: number): boolean {
  if (bytes[labelEnd] !== APPLICATION_IDENTIFIER_LENGTH) return false;
  if (labelEnd + 1 + APPLICATION_IDENTIFIER_LENGTH > bytes.length) return false;
  return KEPT_APPLICATIONS.has(
    asciiAt(bytes, labelEnd + 1, APPLICATION_IDENTIFIER_LENGTH),
  );
}

export function stripGifMetadata(bytes: Uint8Array): Uint8Array | null {
  const signature = asciiAt(bytes, 0, Math.min(HEADER_LENGTH, bytes.length));
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;

  const preambleEnd =
    HEADER_LENGTH + SCREEN_DESCRIPTOR_LENGTH;
  if (bytes.length < preambleEnd) return null;
  let offset = preambleEnd + colourTableLength(bytes[HEADER_LENGTH + 4]);
  if (offset > bytes.length) return null;

  const kept: Uint8Array[] = [bytes.subarray(0, offset)];

  for (;;) {
    if (offset >= bytes.length) return null;
    const introducer = bytes[offset];

    if (introducer === TRAILER) {
      kept.push(bytes.subarray(offset, offset + 1));
      break;
    }

    if (introducer === IMAGE_SEPARATOR) {
      const packedOffset = offset + 1 + IMAGE_DESCRIPTOR_LENGTH - 1;
      if (packedOffset >= bytes.length) return null;
      const dataStart =
        offset + 1 + IMAGE_DESCRIPTOR_LENGTH + colourTableLength(bytes[packedOffset]) + 1;
      if (dataStart > bytes.length) return null;
      const end = subBlocksEnd(bytes, dataStart);
      if (end < 0) return null;
      kept.push(bytes.subarray(offset, end));
      offset = end;
      continue;
    }

    if (introducer === EXTENSION_INTRODUCER) {
      if (offset + 2 > bytes.length) return null;
      const label = bytes[offset + 1];
      const bodyStart = offset + 2;
      const end = subBlocksEnd(bytes, bodyStart);
      if (end < 0) return null;
      const keep =
        label === COMMENT_LABEL
          ? false
          : label === APPLICATION_LABEL
            ? isKeptApplication(bytes, bodyStart)
            : true;
      if (keep) kept.push(bytes.subarray(offset, end));
      offset = end;
      continue;
    }

    return null;
  }

  const length = kept.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let position = 0;
  for (const chunk of kept) {
    output.set(chunk, position);
    position += chunk.length;
  }
  return output;
}
