import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Font } from "fontkit";
import { beforeAll, describe, expect, it } from "vitest";
import {
  APP_ICONS,
  buildAppIconSvg,
  buildAppIcons,
  buildIconContactSheet,
  MASKABLE_SAFE_ZONE_RADIUS,
  rasterise,
} from "./app-icons";
import { FONT_FILE } from "./brand-svgs";
import { loadFont } from "./font-outlining";
import { readPngSize } from "./png-size";

const root = fileURLToPath(new URL("..", import.meta.url));

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

function tags(svg: string, name: string): string[] {
  return svg.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
}

function pathBounds(svg: string): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const numbers = tags(svg, "path").flatMap((tag) =>
    (attribute(tag, "d") ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [],
  );
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe("app icons", () => {
  let font: Font;

  beforeAll(async () => {
    font = await loadFont(resolve(root, FONT_FILE));
  });

  it("defines the expected icon set", () => {
    expect(APP_ICONS).toEqual([
      { path: "public/icons/icon-192.png", size: 192, purpose: "any" },
      { path: "public/icons/icon-512.png", size: 512, purpose: "any" },
      { path: "public/icons/maskable-192.png", size: 192, purpose: "maskable" },
      { path: "public/icons/maskable-512.png", size: 512, purpose: "maskable" },
      {
        path: "public/icons/monochrome-512.png",
        size: 512,
        purpose: "monochrome",
      },
      {
        path: "public/icons/apple-touch-icon.png",
        size: 180,
        purpose: "apple-touch-icon",
      },
    ]);
  });

  it.each(APP_ICONS)("rasterises $path at its native size", async (icon) => {
    const png = await rasterise(buildAppIconSvg(font, icon));

    expect(readPngSize(png)).toEqual({ width: icon.size, height: icon.size });
  });

  it.each(
    APP_ICONS.filter(
      (icon) => icon.purpose === "maskable" || icon.purpose === "monochrome",
    ),
  )("keeps the glyphs of $path inside the safe zone", (icon) => {
    const { minX, minY, maxX, maxY } = pathBounds(buildAppIconSvg(font, icon));
    const centre = icon.size / 2;
    const limit = MASKABLE_SAFE_ZONE_RADIUS * icon.size;

    for (const x of [minX, maxX]) {
      for (const y of [minY, maxY]) {
        expect(Math.hypot(x - centre, y - centre)).toBeLessThanOrEqual(limit);
      }
    }
  });

  it.each(APP_ICONS)("draws the right background for $path", (icon) => {
    const svg = buildAppIconSvg(font, icon);
    const rects = tags(svg, "rect");

    if (icon.purpose === "monochrome") {
      expect(rects).toEqual([]);
      return;
    }
    expect(rects).toHaveLength(1);
    expect(attribute(rects[0], "fill")).toBe("#0a0a0a");
    if (icon.purpose === "any") {
      expect(Number(attribute(rects[0], "rx"))).toBeCloseTo(0.2 * icon.size);
      expect(Number(attribute(rects[0], "ry"))).toBeCloseTo(0.2 * icon.size);
    } else {
      expect(attribute(rects[0], "rx")).toBeUndefined();
      expect(attribute(rects[0], "width")).toBe(String(icon.size));
      expect(attribute(rects[0], "height")).toBe(String(icon.size));
    }
  });

  it.each(APP_ICONS)("keeps $path free of styles, text and fonts", (icon) => {
    expect(buildAppIconSvg(font, icon)).not.toMatch(
      /<style|<text|font|href/,
    );
  });

  it("rasterises deterministically", async () => {
    const svg = buildAppIconSvg(font, APP_ICONS[2]);

    expect(await rasterise(svg)).toEqual(await rasterise(svg));
  });

  it("builds every icon PNG", async () => {
    const icons = await buildAppIcons(font);

    expect(icons.map((icon) => icon.path)).toEqual(
      APP_ICONS.map((icon) => icon.path),
    );
    icons.forEach((icon, index) => {
      expect(readPngSize(icon.contents).width).toBe(APP_ICONS[index].size);
    });
  });

  it("builds a contact sheet PNG", async () => {
    const { width, height } = readPngSize(await buildIconContactSheet(font));

    expect(width).toBe(32 + APP_ICONS.reduce((sum, i) => sum + i.size + 32, 0));
    expect(height).toBe(512 * 2 + 32 * 3);
  });

  it("rejects bytes that are not a PNG", () => {
    expect(() => readPngSize(new Uint8Array(32))).toThrow(/PNG/);
  });
});
