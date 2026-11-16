import { describe, expect, it } from "vitest";
import { IPHONE_SCREEN } from "./ios-landing-screenshots";
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

function pixel(image: RgbaImage, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return [...image.data.subarray(i, i + 4)];
}

describe("iOS landing screenshots", () => {
  it("derives @1x and @2x images from a 3x store screenshot", async () => {
    const images = await buildLandingScreenshots(
      solid(402 * 3, 874 * 3),
      IPHONE_SCREEN,
    );

    expect(
      images.map(({ scale, image }) => [scale, image.width, image.height]),
    ).toEqual([
      [1, 402, 874],
      [2, 804, 1748],
    ]);
    expect(pixel(images[1].image, 402, 874)).toEqual([40, 120, 200, 255]);
    expect(pixel(images[0].image, 201, 0)).toEqual([40, 120, 200, 255]);
  });

  it("makes the corners transparent with antialiased edges and keeps the edges opaque", async () => {
    const image = await roundScreenCorners(solid(402, 874), IPHONE_SCREEN);
    const { width, height } = image;
    const alpha = (x: number, y: number) => pixel(image, x, y)[3];

    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ]) {
      expect(alpha(x, y)).toBe(0);
    }
    expect([
      alpha(width / 2, 0),
      alpha(0, height / 2),
      alpha(width - 1, height / 2),
    ]).toEqual([255, 255, 255]);
    const diagonal = Array.from({ length: 40 }, (_, i) => alpha(i, i));
    expect(diagonal.some((value) => value > 0 && value < 255)).toBe(true);
    expect(pixel(image, 20, 20).slice(0, 3)).toEqual([40, 120, 200]);
  });

  it("refuses a screenshot that isn't 3x", async () => {
    await expect(
      buildLandingScreenshots(solid(1207, 2622), IPHONE_SCREEN),
    ).rejects.toThrow(/not a multiple of 3/);
  });
});
