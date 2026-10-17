import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import type { Font } from "fontkit";
import {
  FAVICON_STYLE,
  faviconGlyphBox,
  layoutFaviconGlyphs,
  type GlyphFit,
} from "./brand-svgs";
import { buildShortcutIcons, SHORTCUT_ICONS } from "./shortcut-icons";

export type AppIconPurpose =
  | "any"
  | "maskable"
  | "monochrome"
  | "apple-touch-icon";

export interface AppIcon {
  path: string;
  size: number;
  purpose: AppIconPurpose;
}

export const APP_ICONS: readonly AppIcon[] = [
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
];

export const MASKABLE_SAFE_ZONE_RADIUS = 0.4;

export const TILE = "#0a0a0a";
export const LETTERS = "#fafafa";
const MONOCHROME_LETTERS = "#000000";
export const CORNER_RADIUS = 0.2;
const SAFE_ZONE_FIT = 0.36;
const SHEET_GAP = 32;
const SHEET_LIGHT = "#fafafa";
const SHEET_DARK = "#0b0b0b";
const SAFE_ZONE_STROKE = "#ff00ff";

export function buildAppIconSvg(font: Font, icon: AppIcon): string {
  const edge = icon.size;
  const background = {
    any: `  <rect width="${edge}" height="${edge}" rx="${edge * CORNER_RADIUS}" ry="${edge * CORNER_RADIUS}" fill="${TILE}"/>`,
    maskable: `  <rect width="${edge}" height="${edge}" fill="${TILE}"/>`,
    "apple-touch-icon": `  <rect width="${edge}" height="${edge}" fill="${TILE}"/>`,
    monochrome: undefined,
  }[icon.purpose];
  const fit: GlyphFit =
    icon.purpose === "maskable" || icon.purpose === "monochrome"
      ? { kind: "halfDiagonal", length: SAFE_ZONE_FIT * edge }
      : { kind: "box", size: faviconGlyphBox(FAVICON_STYLE, edge) };
  const fill = icon.purpose === "monochrome" ? MONOCHROME_LETTERS : LETTERS;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}" viewBox="0 0 ${edge} ${edge}">`,
    ...(background === undefined ? [] : [background]),
    `  <g fill="${fill}">`,
    ...layoutFaviconGlyphs(font, FAVICON_STYLE, edge, fit).map((data) => `    <path d="${data}"/>`),
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

let wasmReady: Promise<void> | undefined;

function ensureWasm(): Promise<void> {
  wasmReady ??= (async () => {
    const wasmPath = createRequire(import.meta.url).resolve(
      "@resvg/resvg-wasm/index_bg.wasm",
    );
    await initWasm(await readFile(wasmPath));
  })();
  return wasmReady;
}

export async function rasterise(svg: string): Promise<Uint8Array> {
  await ensureWasm();
  return new Resvg(svg).render().asPng();
}

export async function buildAppIcons(
  font: Font,
): Promise<{ path: string; contents: Uint8Array }[]> {
  return Promise.all(
    APP_ICONS.map(async (icon) => ({
      path: icon.path,
      contents: await rasterise(buildAppIconSvg(font, icon)),
    })),
  );
}

export async function buildIconContactSheet(font: Font): Promise<Uint8Array> {
  const icons: readonly { path: string; size: number; purpose?: AppIconPurpose }[] = [
    ...APP_ICONS,
    ...SHORTCUT_ICONS,
  ];
  const pngs = [...(await buildAppIcons(font)), ...(await buildShortcutIcons())];
  const rowHeight = Math.max(...icons.map((icon) => icon.size));
  const width =
    icons.reduce((sum, icon) => sum + icon.size + SHEET_GAP, SHEET_GAP);
  const height = rowHeight * 2 + SHEET_GAP * 3;
  const rows = [SHEET_LIGHT, SHEET_DARK].flatMap((background, row) => {
    const top = SHEET_GAP + row * (rowHeight + SHEET_GAP);
    let left = SHEET_GAP;
    const items = icons.flatMap((icon, index) => {
      const x = left;
      left += icon.size + SHEET_GAP;
      const base64 = Buffer.from(pngs[index].contents).toString("base64");
      return [
        `  <image x="${x}" y="${top}" width="${icon.size}" height="${icon.size}" href="data:image/png;base64,${base64}"/>`,
        ...(icon.purpose === "maskable"
          ? [
              `  <circle cx="${x + icon.size / 2}" cy="${top + icon.size / 2}" r="${icon.size * MASKABLE_SAFE_ZONE_RADIUS}" fill="none" stroke="${SAFE_ZONE_STROKE}" stroke-width="2"/>`,
            ]
          : []),
      ];
    });
    return [
      `  <rect x="0" y="${top - SHEET_GAP / 2}" width="${width}" height="${rowHeight + SHEET_GAP}" fill="${background}"/>`,
      ...items,
    ];
  });
  return rasterise(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      ...rows,
      "</svg>",
    ].join("\n"),
  );
}
