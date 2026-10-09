const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function readPngSize(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  if (
    bytes.length < 24 ||
    SIGNATURE.some((value, index) => bytes[index] !== value)
  ) {
    throw new Error("Not a PNG: missing signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
