import { readFile } from "node:fs/promises";
import { create, type Font } from "fontkit";
import { decompress } from "wawoff2";

export interface TextRun {
  text: string;
  weight: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface OutlinedGlyph {
  commands: { command: string; args: number[] }[];
  offset: number;
  box: Bounds;
}

export interface Outline {
  glyphs: OutlinedGlyph[];
  bounds: Bounds;
  unitsPerEm: number;
}

export async function loadFont(path: string): Promise<Font> {
  const opened = create(Buffer.from(await decompress(await readFile(path))));
  if (!("variationAxes" in opened)) {
    throw new Error("Expected a single font, got a collection");
  }
  return opened;
}

export function lowestOpticalSize(font: Font): number | undefined {
  return font.variationAxes.opsz?.min;
}

function instance(
  font: Font,
  weight: number,
  opticalSize: number | undefined,
): Font {
  const settings: Record<string, number> = { wght: weight };
  if (opticalSize !== undefined && "opsz" in font.variationAxes) {
    settings.opsz = opticalSize;
  }
  return font.getVariation(settings);
}

export function outlineRuns(
  font: Font,
  runs: readonly TextRun[],
  options: { trackingEm: number; opticalSize?: number },
): Outline {
  const glyphs: OutlinedGlyph[] = [];
  let pen = 0;
  for (const run of runs) {
    const face = instance(font, run.weight, options.opticalSize);
    for (const character of run.text) {
      const glyph = face.glyphForCodePoint(character.codePointAt(0) ?? 0);
      glyphs.push({
        commands: glyph.path.commands,
        offset: pen,
        box: glyph.path.bbox,
      });
      pen += glyph.advanceWidth + options.trackingEm * face.unitsPerEm;
    }
  }
  const bounds: Bounds = {
    minX: Math.min(...glyphs.map((g) => g.offset + g.box.minX)),
    minY: Math.min(...glyphs.map((g) => g.box.minY)),
    maxX: Math.max(...glyphs.map((g) => g.offset + g.box.maxX)),
    maxY: Math.max(...glyphs.map((g) => g.box.maxY)),
  };
  return { glyphs, bounds, unitsPerEm: font.unitsPerEm };
}

export function round(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export function renderPaths(
  outline: Outline,
  placement: { scale: number; left: number; top: number },
): string[] {
  const { bounds } = outline;
  const { scale, left, top } = placement;
  return outline.glyphs.map(({ commands, offset }) => {
    const x = (value: number): string =>
      round((offset + value - bounds.minX) * scale + left);
    const y = (value: number): string =>
      round((bounds.maxY - value) * scale + top);
    return commands
      .map(({ command, args }) => {
        switch (command) {
          case "moveTo":
            return `M${x(args[0])} ${y(args[1])}`;
          case "lineTo":
            return `L${x(args[0])} ${y(args[1])}`;
          case "quadraticCurveTo":
            return `Q${x(args[0])} ${y(args[1])} ${x(args[2])} ${y(args[3])}`;
          case "bezierCurveTo":
            return `C${x(args[0])} ${y(args[1])} ${x(args[2])} ${y(args[3])} ${x(args[4])} ${y(args[5])}`;
          case "closePath":
            return "Z";
          default:
            throw new Error(`Unsupported path command: ${command}`);
        }
      })
      .join("");
  });
}
