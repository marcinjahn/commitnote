import type { Font } from "fontkit";
import { caretTailStops, CARET_TAIL_LENGTH } from "../src/editor/caret-style";
import { accentOption } from "../src/settings/accent-palette";
import { caretBlinkCss } from "./caret-blink";
import { mixOklab } from "./color-mix";
import {
  lowestOpticalSize,
  outlineRuns,
  renderPaths,
  round,
} from "./font-outlining";

export const FONT_FILE = "src/assets/fonts/InterVariable.woff2";

const EM = 100;
const PADDING = 4;
const TRACKING_EM = -0.022;
const OPTICAL_SIZE = 20;
// The app caret is CARET_WIDTH_PX (2 px) wide next to the 20 px topbar wordmark.
const CARET_WIDTH_EM = 0.1;

// On-screen px per SVG unit, pinned to the README's 240 px rendering of the 539.65-unit caret-less wordmark.
export const WORDMARK_DISPLAY_SCALE = 240 / 539.65;

export function readmeWordmarkWidth(svgWidth: number): number {
  return Math.round(svgWidth * WORDMARK_DISPLAY_SCALE);
}

const WORDMARK_RUNS = [
  { text: "commit", weight: 600 },
  { text: "note", weight: 400 },
] as const;

export interface WordmarkColors {
  text: string;
  accent: string;
}

function gradientOffset(value: number): string {
  return String(Number(value.toFixed(4)));
}

export function buildWordmarkSvg(font: Font, colors: WordmarkColors): string {
  const outline = outlineRuns(font, WORDMARK_RUNS, {
    trackingEm: TRACKING_EM,
    opticalSize: OPTICAL_SIZE,
  });
  const scale = EM / outline.unitsPerEm;
  const { bounds, glyphs } = outline;
  const svgX = (fontX: number): number =>
    (fontX - bounds.minX) * scale + PADDING;
  const height = (bounds.maxY - bounds.minY) * scale + PADDING * 2;
  const pathData = renderPaths(outline, {
    scale,
    left: PADDING,
    top: PADDING,
  });

  const tail = glyphs.slice(-CARET_TAIL_LENGTH);
  const last = tail[tail.length - 1];
  const boundaries = [
    ...tail.map((glyph) => glyph.offset),
    last.offset + last.advance,
  ];
  const start = boundaries[0];
  const end = boundaries[boundaries.length - 1];
  const mixes = caretTailStops(CARET_TAIL_LENGTH);
  const stops = boundaries.map(
    (boundary, i) =>
      `      <stop offset="${gradientOffset((boundary - start) / (end - start))}" stop-color="${mixOklab(colors.text, colors.accent, mixes[i])}"/>`,
  );

  const caretX = svgX(end);
  const caretWidth = CARET_WIDTH_EM * EM;
  const w = round(caretX + caretWidth + PADDING);
  const h = round(height);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    "  <style>",
    ...caretBlinkCss(".caret").map((line) => `    ${line}`),
    "  </style>",
    "  <defs>",
    `    <linearGradient id="caret-tail" gradientUnits="userSpaceOnUse" x1="${round(svgX(start))}" y1="0" x2="${round(caretX)}" y2="0">`,
    ...stops,
    "    </linearGradient>",
    "  </defs>",
    `  <g fill="${colors.text}">`,
    ...pathData.map((data) => `    <path d="${data}"/>`),
    "  </g>",
    '  <g class="caret">',
    '    <g fill="url(#caret-tail)">',
    ...pathData
      .slice(-CARET_TAIL_LENGTH)
      .map((data) => `      <path d="${data}"/>`),
    "    </g>",
    `    <rect x="${round(caretX)}" y="0" width="${round(caretWidth)}" height="${h}" fill="${colors.accent}"/>`,
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

export interface FaviconStyle {
  tile: boolean;
  weights: readonly [c: number, n: number];
  inset: number;
  trackingEm: number;
}

export const FAVICON_STYLE: FaviconStyle = {
  tile: true,
  weights: [700, 400],
  inset: 3,
  trackingEm: -0.022,
};

const FAVICON_SIZE = 32;

export type GlyphFit =
  | { kind: "box"; size: number }
  | { kind: "halfDiagonal"; length: number };

export function faviconGlyphBox(style: FaviconStyle, edge: number): number {
  return (edge * (FAVICON_SIZE - 2 * style.inset)) / FAVICON_SIZE;
}

export function layoutFaviconGlyphs(
  font: Font,
  style: FaviconStyle,
  edge: number,
  fit: GlyphFit,
): string[] {
  const outline = outlineRuns(
    font,
    [
      { text: "c", weight: style.weights[0] },
      { text: "n", weight: style.weights[1] },
    ],
    { trackingEm: style.trackingEm, opticalSize: lowestOpticalSize(font) },
  );
  const { bounds } = outline;
  const inkWidth = bounds.maxX - bounds.minX;
  const inkHeight = bounds.maxY - bounds.minY;
  const scale =
    fit.kind === "box"
      ? Math.min(fit.size / inkWidth, fit.size / inkHeight)
      : fit.length / (Math.hypot(inkWidth, inkHeight) / 2);
  return renderPaths(outline, {
    scale,
    left: (edge - inkWidth * scale) / 2,
    top: (edge - inkHeight * scale) / 2,
  });
}

export function buildFaviconSvg(font: Font, style: FaviconStyle): string {
  const paths = layoutFaviconGlyphs(font, style, FAVICON_SIZE, {
    kind: "box",
    size: faviconGlyphBox(style, FAVICON_SIZE),
  }).map((data) => `  <path d="${data}"/>`);

  const [light, dark] = style.tile
    ? [
        ["    rect { fill: #0a0a0a }", "    path { fill: #fafafa }"],
        ["      rect { fill: #ededed }", "      path { fill: #0b0b0b }"],
      ]
    : [["    path { fill: #0a0a0a }"], ["      path { fill: #ededed }"]];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FAVICON_SIZE} ${FAVICON_SIZE}">`,
    "  <style>",
    ...light,
    "    @media (prefers-color-scheme: dark) {",
    ...dark,
    "    }",
    "  </style>",
    ...(style.tile
      ? [`  <rect width="${FAVICON_SIZE}" height="${FAVICON_SIZE}"/>`]
      : []),
    ...paths,
    "</svg>",
    "",
  ].join("\n");
}

export interface BrandSvg {
  path: string;
  contents: string;
}

export function buildBrandSvgs(font: Font): BrandSvg[] {
  const orange = accentOption("orange");
  if (orange.light === undefined || orange.dark === undefined) {
    throw new Error("The orange accent needs both light and dark colours");
  }
  return [
    {
      path: "docs/brand/wordmark-light.svg",
      contents: buildWordmarkSvg(font, {
        text: "#0a0a0a",
        accent: orange.light,
      }),
    },
    {
      path: "docs/brand/wordmark-dark.svg",
      contents: buildWordmarkSvg(font, {
        text: "#ededed",
        accent: orange.dark,
      }),
    },
    {
      path: "src/assets/favicon.svg",
      contents: buildFaviconSvg(font, FAVICON_STYLE),
    },
  ];
}
