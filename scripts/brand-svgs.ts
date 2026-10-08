import type { Font } from "fontkit";
import { outlineRuns, renderPaths, round } from "./font-outlining";

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
  ];
}
