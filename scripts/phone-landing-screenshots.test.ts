import { describe, expect, it } from "vitest";
import {
  buildLandingScreenshots,
  type PhoneScreen,
} from "./phone-landing-screenshots";
import type { RgbaImage } from "./png-codec";

const SQUARE_PHONE: PhoneScreen = {
  logicalWidth: (screenshotWidth) => screenshotWidth / 4,
  outlinePath: (width, height) => `M0 0H${width}V${height}H0Z`,
};

function solid(width: number, height: number, alpha = 255): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([40, 120, 200, alpha], i);
  return { width, height, data };
}

function pixel(image: RgbaImage, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return [...image.data.subarray(i, i + 4)];
}

describe("phone landing screenshots", () => {
  it("derives @1x and @2x images at the phone's logical width", async () => {
    const images = await buildLandingScreenshots(
      solid(400, 800),
      SQUARE_PHONE,
    );

    expect(
      images.map(({ scale, image }) => [scale, image.width, image.height]),
    ).toEqual([
      [1, 100, 200],
      [2, 200, 400],
    ]);
    expect(pixel(images[1].image, 100, 200)).toEqual([40, 120, 200, 255]);
  });

  it("refuses a screenshot that is already transparent, so nothing is rounded twice", async () => {
    await expect(
      buildLandingScreenshots(solid(400, 800, 0), SQUARE_PHONE),
    ).rejects.toThrow(/transparent/);
  });
});
