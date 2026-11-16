import { Resvg } from "@resvg/resvg-wasm";
import { ensureWasm } from "./app-icons";
import { resampleToWidth } from "./image-resample";
import type { RgbaImage } from "./png-codec";

export const LANDING_SCALES = [1, 2] as const;
export type LandingScale = (typeof LANDING_SCALES)[number];

/** The phone a set of screenshots was taken on. */
export interface PhoneScreen {
  /** The @1x width of a screenshot this many device pixels wide; throws for a size it can't come in. */
  logicalWidth(screenshotWidth: number): number;
  /** The outline of the screen at this size, as SVG path data. */
  outlinePath(width: number, height: number): string;
}

export function formatSvgNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

async function screenCoverage(
  screen: PhoneScreen,
  width: number,
  height: number,
): Promise<Uint8Array> {
  await ensureWasm();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${screen.outlinePath(width, height)}" fill="#fff"/></svg>`;
  const rendered = new Resvg(svg).render();
  const pixels = rendered.pixels;
  rendered.free();
  const coverage = new Uint8Array(width * height);
  for (let i = 0; i < coverage.length; i++) coverage[i] = pixels[i * 4 + 3];
  return coverage;
}

function assertOpaque(image: RgbaImage): void {
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i] !== 255) {
      throw new Error(
        "The phone screenshot has transparent pixels; expected an opaque device screenshot, not an already rounded one",
      );
    }
  }
}

/** Cuts an opaque screenshot to the phone's screen shape, leaving the corners transparent. */
export async function roundScreenCorners(
  image: RgbaImage,
  screen: PhoneScreen,
): Promise<RgbaImage> {
  assertOpaque(image);
  const coverage = await screenCoverage(screen, image.width, image.height);
  const data = Uint8Array.from(image.data);
  for (let i = 0; i < coverage.length; i++) data[i * 4 + 3] = coverage[i];
  return { width: image.width, height: image.height, data };
}

/** Turns an opaque device screenshot into one rounded landing image per landing scale. */
export async function buildLandingScreenshots(
  screenshot: RgbaImage,
  screen: PhoneScreen,
): Promise<{ scale: LandingScale; image: RgbaImage }[]> {
  assertOpaque(screenshot);
  const logicalWidth = screen.logicalWidth(screenshot.width);
  return Promise.all(
    LANDING_SCALES.map(async (scale) => ({
      scale,
      image: await roundScreenCorners(
        resampleToWidth(screenshot, logicalWidth * scale),
        screen,
      ),
    })),
  );
}
