import { actionIcons, searchIcon } from "../src/ui/browse/action-icons";
import { CORNER_RADIUS, LETTERS, rasterise, TILE } from "./app-icons";

export interface ShortcutIcon {
  path: string;
  size: number;
  glyph: readonly string[];
}

export const SHORTCUT_ICONS: readonly ShortcutIcon[] = [
  {
    path: "public/icons/shortcut-new-note-96.png",
    size: 96,
    glyph: actionIcons["new-note"],
  },
  { path: "public/icons/shortcut-search-96.png", size: 96, glyph: searchIcon },
];

const GLYPH_BOX = 16;
const GLYPH_SHARE = 0.6;
const STROKE_WIDTH = 1.5;

export function buildShortcutIconSvg(icon: ShortcutIcon): string {
  const edge = icon.size;
  const scale = (edge * GLYPH_SHARE) / GLYPH_BOX;
  const offset = (edge * (1 - GLYPH_SHARE)) / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}" viewBox="0 0 ${edge} ${edge}">`,
    `  <rect width="${edge}" height="${edge}" rx="${edge * CORNER_RADIUS}" ry="${edge * CORNER_RADIUS}" fill="${TILE}"/>`,
    `  <g fill="none" stroke="${LETTERS}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round" transform="translate(${offset} ${offset}) scale(${scale})">`,
    ...icon.glyph.map((data) => `    <path d="${data}"/>`),
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

export async function buildShortcutIcons(): Promise<
  { path: string; contents: Uint8Array }[]
> {
  return Promise.all(
    SHORTCUT_ICONS.map(async (icon) => ({
      path: icon.path,
      contents: await rasterise(buildShortcutIconSvg(icon)),
    })),
  );
}
