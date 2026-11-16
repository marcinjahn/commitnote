import { describe, expect, it } from "vitest";
import { ANDROID_SCREEN } from "./android-landing-screenshots";
import {
  buildLandingScreenshots,
  roundScreenCorners,
} from "./phone-landing-screenshots";
import type { RgbaImage } from "./png-codec";

function solid(width: number, height: number, alpha = 255): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([40, 120, 200, alpha], i);
  return { width, height, data };
}

function alpha(image: RgbaImage, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3];
}

describe("Android landing screenshots", () => {
  it("derives @1x and @2x images from a 420 dpi emulator screenshot, at whole logical pixels", async () => {
    const images = await buildLandingScreenshots(
      solid(1080, 2400),
      ANDROID_SCREEN,
    );

    expect(images.map(({ scale, image }) => [scale, image.width])).toEqual([
      [1, 411],
      [2, 822],
    ]);
    expect(images[1].image.height).toBe(Math.round((2400 * 822) / 1080));
  });

  it("rounds the corners with circular arcs a tenth of the width across", async () => {
    const image = await roundScreenCorners(solid(400, 880), ANDROID_SCREEN);
    const { width, height } = image;

    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
      [9, 9],
    ]) {
      expect(alpha(image, x, y)).toBe(0);
    }
    expect([
      alpha(image, 40, 0),
      alpha(image, width - 41, 0),
      alpha(image, 0, 40),
      alpha(image, 14, 14),
      alpha(image, width / 2, height / 2),
    ]).toEqual([255, 255, 255, 255, 255]);
  });
});
