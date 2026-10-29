import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { LETTERS, TILE } from "./app-icons";
import { FONT_FILE } from "./brand-svgs";
import { loadFont } from "./font-outlining";
import { buildGnomeIcons, GNOME_ICONS } from "./gnome-icons";

const root = fileURLToPath(new URL("..", import.meta.url));

let scalable: string;
let symbolic: string;

beforeAll(async () => {
  const font = await loadFont(resolve(root, FONT_FILE));
  const outputs = buildGnomeIcons(font);
  const contentsOf = (path: string): string => {
    const contents = outputs.find((output) => output.path === path)?.contents;
    if (typeof contents !== "string") {
      throw new Error(`Missing SVG output ${path}`);
    }
    return contents;
  };
  scalable = contentsOf(GNOME_ICONS.scalable);
  symbolic = contentsOf(GNOME_ICONS.symbolic);
});

describe("GNOME icons", () => {
  it("draws the symbolic icon in one theme-recolourable fill", () => {
    expect(symbolic).toContain('viewBox="0 0 16 16"');
    expect(new Set(symbolic.match(/fill="[^"]*"/g))).toEqual(
      new Set(['fill="#2e3436"']),
    );
    for (const forbidden of ["<style", "<text", "<image", "stroke"]) {
      expect(symbolic).not.toContain(forbidden);
    }
    expect(symbolic).toContain("<path");
  });

  it("draws the scalable icon as the full-colour tile", () => {
    expect(scalable).toContain('viewBox="0 0 128 128"');
    expect(scalable).toContain(`fill="${TILE}"`);
    expect(scalable).toContain(`fill="${LETTERS}"`);
  });

  it("ends every SVG with a single newline", () => {
    for (const svg of [scalable, symbolic]) {
      expect(svg.endsWith("</svg>\n")).toBe(true);
    }
  });
});
