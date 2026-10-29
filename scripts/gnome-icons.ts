import type { Font } from "fontkit";
import { buildAppIconSvg } from "./app-icons";
import type { BrandOutput } from "./brand-outputs";
import { FAVICON_STYLE, layoutFaviconGlyphs } from "./brand-svgs";

const APP_ID = "io.github.marcinjahn.commitnote";

export const GNOME_ICONS = {
  scalable: `apps/linux/data/icons/hicolor/scalable/apps/${APP_ID}.svg`,
  symbolic: `apps/linux/data/icons/hicolor/symbolic/apps/${APP_ID}-symbolic.svg`,
} as const;

const SCALABLE_SIZE = 128;
const SYMBOLIC_SIZE = 16;
const SYMBOLIC_GLYPH_BOX = 14;
const SYMBOLIC_FILL = "#2e3436";

function buildSymbolicSvg(font: Font): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SYMBOLIC_SIZE}" height="${SYMBOLIC_SIZE}" viewBox="0 0 ${SYMBOLIC_SIZE} ${SYMBOLIC_SIZE}">`,
    `  <g fill="${SYMBOLIC_FILL}">`,
    ...layoutFaviconGlyphs(font, FAVICON_STYLE, SYMBOLIC_SIZE, {
      kind: "box",
      size: SYMBOLIC_GLYPH_BOX,
    }).map((data) => `    <path d="${data}"/>`),
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

export function buildGnomeIcons(font: Font): BrandOutput[] {
  return [
    {
      path: GNOME_ICONS.scalable,
      contents: buildAppIconSvg(font, {
        path: GNOME_ICONS.scalable,
        size: SCALABLE_SIZE,
        purpose: "any",
      }),
    },
    { path: GNOME_ICONS.symbolic, contents: buildSymbolicSvg(font) },
  ];
}
