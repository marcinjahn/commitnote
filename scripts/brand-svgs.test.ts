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

  it("covers both wordmark variants", () => {
    const paths = buildBrandSvgs(font).map((svg) => svg.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        "docs/brand/wordmark-light.svg",
        "docs/brand/wordmark-dark.svg",
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
});
