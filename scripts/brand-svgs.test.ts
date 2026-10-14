import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Font } from "fontkit";
import { beforeAll, describe, expect, it } from "vitest";
import { CARET_TAIL_LENGTH } from "../src/editor/caret-style";
import { accentOption } from "../src/settings/accent-palette";
import { buildBrandSvgs, FONT_FILE, readmeWordmarkWidth } from "./brand-svgs";
import { loadFont } from "./font-outlining";

const root = fileURLToPath(new URL("..", import.meta.url));

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

function firstTag(svg: string, name: string): string {
  return svg.match(new RegExp(`<${name}\\b[^>]*>`))?.[0] ?? "";
}

function allTags(svg: string, name: string): string[] {
  return svg.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
}

function between(svg: string, open: string, close: string): string {
  const start = svg.indexOf(open);
  const end = svg.indexOf(close, start);
  return start === -1 || end === -1 ? "" : svg.slice(start, end + close.length);
}

function pathData(svg: string): string[] {
  return allTags(svg, "path").map((tag) => attribute(tag, "d") ?? "");
}

function wordmarkContents(font: Font, path: string): string {
  const svg = buildBrandSvgs(font).find((candidate) => candidate.path === path);
  if (svg === undefined) {
    throw new Error(`No generated SVG for ${path}`);
  }
  return svg.contents;
}

describe("brand SVGs", () => {
  let font: Font;

  beforeAll(async () => {
    font = await loadFont(resolve(root, FONT_FILE));
  });

  it("covers both wordmark variants and the favicon", () => {
    const paths = buildBrandSvgs(font).map((svg) => svg.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        "docs/brand/wordmark-light.svg",
        "docs/brand/wordmark-dark.svg",
        "src/assets/favicon.svg",
      ]),
    );
  });

  it("matches the committed files", async () => {
    for (const svg of buildBrandSvgs(font)) {
      const committed = await readFile(resolve(root, svg.path), "utf8");

      expect(
        committed === svg.contents,
        `${svg.path} is out of date, run \`npm run generate:brand\``,
      ).toBe(true);
    }
  });

  describe("favicon", () => {
    let favicon: string;

    beforeAll(async () => {
      favicon = await readFile(resolve(root, "src/assets/favicon.svg"), "utf8");
    });

    it("is a square self-contained outline", () => {
      const svgTag = favicon.match(/<svg[^>]*>/)?.[0] ?? "";

      expect(svgTag).toContain('viewBox="0 0 32 32"');
      expect(svgTag).not.toMatch(/\s(width|height)=/);
      expect(favicon).toContain("<path");
      expect(favicon).not.toContain("<text");
      expect(favicon).not.toContain("font");
      expect(favicon).not.toContain("href");
      expect(favicon).not.toContain("url(");
    });

    it("switches colours in dark mode", () => {
      expect(favicon).toContain("@media (prefers-color-scheme: dark)");
    });
  });
  describe("wordmark", () => {
    const orange = accentOption("orange");
    const variants = [
      {
        path: "docs/brand/wordmark-light.svg",
        text: "#0a0a0a",
        accent: orange.light,
      },
      {
        path: "docs/brand/wordmark-dark.svg",
        text: "#ededed",
        accent: orange.dark,
      },
    ];

    describe.each(variants)("$path", ({ path, text, accent }) => {
      let svg: string;
      let svgTag: string;

      beforeAll(() => {
        svg = wordmarkContents(font, path);
        svgTag = firstTag(svg, "svg");
      });

      it("is wider than the caret-less wordmark at the same height", () => {
        const width = attribute(svgTag, "width");
        const height = attribute(svgTag, "height");

        expect(attribute(svgTag, "viewBox")).toBe(`0 0 ${width} ${height}`);
        expect(height).toBe("84.42");
        expect(Number(width)).toBeGreaterThan(539.65);
      });

      it("blinks the caret forever unless motion is reduced", () => {
        const style = between(svg, "<style>", "</style>");
        const reducedMotion = style.match(
          /@media \(prefers-reduced-motion: reduce\) \{.*\}/,
        )?.[0];

        expect(style).toContain("@keyframes");
        expect(style).toContain("infinite");
        expect(style).toContain("1600ms");
        expect(style).toContain("650ms");
        expect(reducedMotion).toContain("animation: none");
      });

      it("draws the caret in the accent over the full height", () => {
        const rect = firstTag(svg, "rect");

        expect(attribute(rect, "fill")).toBe(accent);
        expect(attribute(rect, "y")).toBe("0");
        expect(attribute(rect, "height")).toBe(attribute(svgTag, "height"));
      });

      it("fades the caret tail from the text colour to the accent", () => {
        const gradient = between(
          svg,
          '<linearGradient id="caret-tail"',
          "</linearGradient>",
        );
        const colors = allTags(gradient, "stop").map((stop) =>
          attribute(stop, "stop-color"),
        );

        expect(colors).toHaveLength(CARET_TAIL_LENGTH + 1);
        expect(colors[0]).toBe(text);
        expect(colors[colors.length - 1]).toBe(accent);
      });

      it("overlays the caret tail glyphs inside the blinking caret group", () => {
        const textGroup = between(svg, `<g fill="${text}">`, "</g>");
        const caretGroup = between(svg, '<g class="caret">', "</svg>");
        const overlay = between(caretGroup, '<g fill="url(#caret-tail)">', "</g>");

        expect(overlay).not.toBe("");
        expect(caretGroup).toContain("<rect");
        expect(pathData(overlay)).toEqual(
          pathData(textGroup).slice(-CARET_TAIL_LENGTH),
        );
      });

      it("is self-contained", () => {
        expect(svg).not.toContain("<script");
        expect(svg).not.toContain("href");
        expect(svg).not.toContain("<text");
        expect(svg.match(/url\([^)]*\)/g)).toEqual(["url(#caret-tail)"]);
      });
    });

    it("keeps both variants the same width", () => {
      const [light, dark] = variants.map(({ path }) =>
        attribute(firstTag(wordmarkContents(font, path), "svg"), "width"),
      );

      expect(light).toBe(dark);
    });

    it("sizes the README image to the display scale", async () => {
      const readme = await readFile(resolve(root, "README.md"), "utf8");
      const img =
        readme.match(/<img\s[^>]*src="docs\/brand\/wordmark-light\.svg"[^>]*>/)?.[0] ??
        "";
      const light = firstTag(
        wordmarkContents(font, "docs/brand/wordmark-light.svg"),
        "svg",
      );

      expect(Number(attribute(img, "width"))).toBe(
        readmeWordmarkWidth(Number(attribute(light, "width"))),
      );
    });
  });
});
