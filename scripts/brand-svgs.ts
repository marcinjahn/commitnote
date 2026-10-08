import type { Font } from "fontkit";
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

const WORDMARK_RUNS = [
  { text: "commit", weight: 600 },
  { text: "note", weight: 400 },
] as const;

export function buildWordmarkSvg(font: Font, fill: string): string {
  const outline = outlineRuns(font, WORDMARK_RUNS, {
    trackingEm: TRACKING_EM,
    opticalSize: OPTICAL_SIZE,
  });
  const scale = EM / outline.unitsPerEm;
  const { bounds } = outline;
  const width = (bounds.maxX - bounds.minX) * scale + PADDING * 2;
  const height = (bounds.maxY - bounds.minY) * scale + PADDING * 2;
  const paths = renderPaths(outline, {
    scale,
    left: PADDING,
    top: PADDING,
  }).map((data) => `    <path d="${data}"/>`);

  const w = round(width);
  const h = round(height);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `  <g fill="${fill}">`,
    ...paths,
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

export function buildFaviconSvg(font: Font, style: FaviconStyle): string {
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
  const available = FAVICON_SIZE - 2 * style.inset;
  const scale = Math.min(available / inkWidth, available / inkHeight);
  const paths = renderPaths(outline, {
    scale,
    left: (FAVICON_SIZE - inkWidth * scale) / 2,
    top: (FAVICON_SIZE - inkHeight * scale) / 2,
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
  return [
    {
      path: "docs/brand/wordmark-light.svg",
      contents: buildWordmarkSvg(font, "#0a0a0a"),
    },
    {
      path: "docs/brand/wordmark-dark.svg",
      contents: buildWordmarkSvg(font, "#ededed"),
    },
    {
      path: "src/assets/favicon.svg",
      contents: buildFaviconSvg(font, FAVICON_STYLE),
    },
  ];
}
