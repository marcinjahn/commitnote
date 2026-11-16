import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-wasm";
import { buildAppIconSvg, ensureWasm } from "./app-icons";
import { FONT_FILE } from "./brand-svgs";
import { loadFont } from "./font-outlining";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = "apps/ios/Commitnote/Assets.xcassets/AppIcon.appiconset/icon-1024.png";
const SIZE = 1024;
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(Buffer.from(type, "ascii"), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodeOpaqueRgbPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      if (rgba[source + 3] !== 255) {
        throw new Error("The app icon must be fully opaque");
      }
      rows.set(rgba.subarray(source, source + 3), rowStart + 1 + x * 3);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

async function main(): Promise<void> {
  const font = await loadFont(resolve(root, FONT_FILE));
  const svg = buildAppIconSvg(font, {
    path: TARGET,
    size: SIZE,
    purpose: "maskable",
  });
  await ensureWasm();
  const image = new Resvg(svg).render();
  const png = encodeOpaqueRgbPng(image.pixels, image.width, image.height);
  const target = resolve(root, TARGET);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, png);
  console.log(target);
}

await main();
