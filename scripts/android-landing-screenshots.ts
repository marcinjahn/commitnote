import {
  formatSvgNumber as format,
  type PhoneScreen,
} from "./phone-landing-screenshots";

/** The screenshots come from a Pixel 7 emulator: 1080 px wide at 420 dpi, so 2.625 px per dp. */
export const ANDROID_SCREENSHOT_PIXEL_RATIO = 420 / 160;

/** Pixel phones round the display by about a tenth of its width, with plain circular corners. */
export const SCREEN_CORNER_RADIUS_RATIO = 0.1;

/** The outline of an Android phone screen of this size, as SVG path data. */
export function screenOutlinePath(width: number, height: number): string {
  const radius = width * SCREEN_CORNER_RADIUS_RATIO;
  const [r, w, h, right, bottom] = [
    radius,
    width,
    height,
    width - radius,
    height - radius,
  ].map(format);
  const arc = `A${r} ${r} 0 0 1`;
  return (
    `M${r} 0H${right}${arc} ${w} ${r}V${bottom}` +
    `${arc} ${right} ${h}H${r}${arc} 0 ${bottom}V${r}${arc} ${r} 0Z`
  );
}

export const ANDROID_SCREEN: PhoneScreen = {
  // Android rounds the screen's width in dp down, so the Pixel 7 is 411 dp wide.
  logicalWidth: (screenshotWidth) =>
    Math.floor(screenshotWidth / ANDROID_SCREENSHOT_PIXEL_RATIO),
  outlinePath: screenOutlinePath,
};
