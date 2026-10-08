import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Font } from "fontkit";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBrandSvgs, FONT_FILE } from "./brand-svgs";
import { loadFont } from "./font-outlining";

const root = fileURLToPath(new URL("..", import.meta.url));

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
});
