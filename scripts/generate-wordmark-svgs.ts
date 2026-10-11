import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { create, type Font } from "fontkit";
import { decompress } from "wawoff2";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fontPath = resolve(root, "src/assets/fonts/InterVariable.woff2");
const outputDirectory = resolve(root, "docs/brand");

const EM = 100;
const PADDING = 4;
const LETTER_SPACING_EM = -0.022;

const variants = [
  ["wordmark-light.svg", "#0a0a0a"],
  ["wordmark-dark.svg", "#ededed"],
] as const;

const parts = [
  { text: "commit", weight: 600 },
  { text: "note", weight: 400 },
] as const;

interface PlacedGlyph {
  commands: { command: string; args: number[] }[];
  offset: number;
  box: { minX: number; minY: number; maxX: number; maxY: number };
}

function instance(font: Font, weight: number): Font {
  const settings: Record<string, number> = { wght: weight };
  if ("opsz" in font.variationAxes) {
    settings.opsz = 20;
  }
  return font.getVariation(settings);
}

function layout(font: Font): { glyphs: PlacedGlyph[]; scale: number } {
  const glyphs: PlacedGlyph[] = [];
  let pen = 0;
  for (const part of parts) {
    const face = instance(font, part.weight);
    for (const character of part.text) {
      const glyph = face.glyphForCodePoint(character.codePointAt(0) ?? 0);
      glyphs.push({
        commands: glyph.path.commands,
        offset: pen,
        box: glyph.path.bbox,
      });
      pen += glyph.advanceWidth + LETTER_SPACING_EM * face.unitsPerEm;
    }
  }
  return { glyphs, scale: EM / font.unitsPerEm };
}

function round(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function buildSvg(font: Font, fill: string): string {
  const { glyphs, scale } = layout(font);
  const minX = Math.min(...glyphs.map((g) => g.offset + g.box.minX));
  const maxX = Math.max(...glyphs.map((g) => g.offset + g.box.maxX));
  const minY = Math.min(...glyphs.map((g) => g.box.minY));
  const maxY = Math.max(...glyphs.map((g) => g.box.maxY));
  const width = (maxX - minX) * scale + PADDING * 2;
  const height = (maxY - minY) * scale + PADDING * 2;

  const x = (value: number, offset: number): string =>
    round((offset + value - minX) * scale + PADDING);
  const y = (value: number): string =>
    round((maxY - value) * scale + PADDING);

  const paths = glyphs.map(({ commands, offset }) => {
    const data = commands
      .map(({ command, args }) => {
        switch (command) {
          case "moveTo":
            return `M${x(args[0], offset)} ${y(args[1])}`;
          case "lineTo":
            return `L${x(args[0], offset)} ${y(args[1])}`;
          case "quadraticCurveTo":
            return `Q${x(args[0], offset)} ${y(args[1])} ${x(args[2], offset)} ${y(args[3])}`;
          case "bezierCurveTo":
            return `C${x(args[0], offset)} ${y(args[1])} ${x(args[2], offset)} ${y(args[3])} ${x(args[4], offset)} ${y(args[5])}`;
          case "closePath":
            return "Z";
          default:
            throw new Error(`Unsupported path command: ${command}`);
        }
      })
      .join("");
    return `    <path d="${data}"/>`;
  });

  const w = round(width);
  const h = round(height);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `  <g fill="${fill}">`,
    ...paths,
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const opened = create(
    Buffer.from(await decompress(await readFile(fontPath))),
  );
  if (!("variationAxes" in opened)) {
    throw new Error("Expected a single font, got a collection");
  }
  await mkdir(outputDirectory, { recursive: true });
  for (const [file, fill] of variants) {
    const target = resolve(outputDirectory, file);
    await writeFile(target, buildSvg(opened, fill), "utf8");
    console.log(target);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
