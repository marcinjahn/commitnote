import { TextEncoder } from "./text-codec";

export type BlobPart = Uint8Array | ArrayBuffer | string;

export interface BlobOptions {
  type?: string;
}

function normalizeType(type: string | undefined): string {
  if (type === undefined) return "";
  const text = String(type);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return "";
  }
  return text.toLowerCase();
}

function partBytes(part: BlobPart): Uint8Array {
  if (typeof part === "string") return new TextEncoder().encode(part);
  if (ArrayBuffer.isView(part)) {
    return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
  }
  return new Uint8Array(part);
}

function relativeIndex(
  value: number | undefined,
  size: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const index = Math.trunc(Number(value)) || 0;
  return index < 0 ? Math.max(size + index, 0) : Math.min(index, size);
}

export class Blob {
  readonly type: string;
  readonly #bytes: Uint8Array;

  constructor(parts: readonly BlobPart[] = [], options: BlobOptions = {}) {
    const chunks = parts.map(partBytes);
    const bytes = new Uint8Array(
      chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.#bytes = bytes;
    this.type = normalizeType(options.type);
  }

  get size(): number {
    return this.#bytes.length;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(this.#bytes.slice().buffer);
  }

  slice(start?: number, end?: number, type?: string): Blob {
    const size = this.#bytes.length;
    const from = relativeIndex(start, size, 0);
    const to = relativeIndex(end, size, size);
    return new Blob([this.#bytes.subarray(from, Math.max(from, to))], { type });
  }
}
