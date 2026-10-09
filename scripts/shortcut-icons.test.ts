import { describe, expect, it } from "vitest";
import { readPngSize } from "./png-size";
import {
  buildShortcutIconSvg,
  buildShortcutIcons,
  SHORTCUT_ICONS,
} from "./shortcut-icons";

describe("shortcut icons", () => {
  it("defines the new note and search icons at 96px", () => {
    expect(SHORTCUT_ICONS.map(({ path, size }) => ({ path, size }))).toEqual([
      { path: "public/icons/shortcut-new-note-96.png", size: 96 },
      { path: "public/icons/shortcut-search-96.png", size: 96 },
    ]);
  });

  it("draws every glyph path with the app stroke width", () => {
    for (const icon of SHORTCUT_ICONS) {
      const svg = buildShortcutIconSvg(icon);
      for (const data of icon.glyph) {
        expect(svg).toContain(`d="${data}"`);
      }
      expect(svg).toContain('stroke-width="1.5"');
    }
  });

  it("rasterises each icon to a 96x96 PNG", async () => {
    const outputs = await buildShortcutIcons();

    expect(outputs.map((output) => output.path)).toEqual(
      SHORTCUT_ICONS.map((icon) => icon.path),
    );
    for (const output of outputs) {
      expect(readPngSize(output.contents)).toEqual({ width: 96, height: 96 });
    }
  });
});
