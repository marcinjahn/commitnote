import {
  formatSvgNumber as format,
  type PhoneScreen,
} from "./phone-landing-screenshots";

/** iPhone screenshots are taken at 3x, so a third of their width is the logical (@1x) width. */
export const IPHONE_SCREENSHOT_SCALE = 3;

/** Modern iPhones round the display by about 55 pt on a 393 pt wide screen. */
export const SCREEN_CORNER_RADIUS_RATIO = 0.14;

/**
 * Apple's continuous ("squircle") corner, as three cubic Béziers in units of the corner radius.
 * Each point is (distance back along the incoming edge, distance along the outgoing edge) from
 * the corner; the curve leaves the straight edges about 1.53 radii before the corner.
 */
const CONTINUOUS_CORNER: readonly (readonly [number, number])[] = [
  [1.52866483, 0],
  [1.08849323, 0],
  [0.86840689, 0],
  [0.63149399, 0.074911],
  [0.37282392, 0.16905899],
  [0.16905899, 0.37282392],
  [0.074911, 0.63149399],
  [0, 0.86840689],
  [0, 1.08849323],
  [0, 1.52866483],
];

/** The outline of a phone screen of this size, with continuous corners, as SVG path data. */
export function screenOutlinePath(width: number, height: number): string {
  const radius = width * SCREEN_CORNER_RADIUS_RATIO;
  const corners = [
    { at: [width, 0], back: [-1, 0], forward: [0, 1] },
    { at: [width, height], back: [0, -1], forward: [-1, 0] },
    { at: [0, height], back: [1, 0], forward: [0, -1] },
    { at: [0, 0], back: [0, 1], forward: [1, 0] },
  ];
  const point = (
    corner: (typeof corners)[number],
    [b, f]: readonly [number, number],
  ) =>
    [
      corner.at[0] + radius * (b * corner.back[0] + f * corner.forward[0]),
      corner.at[1] + radius * (b * corner.back[1] + f * corner.forward[1]),
    ]
      .map(format)
      .join(" ");
  const last = corners[corners.length - 1];
  const commands = [
    `M${point(last, CONTINUOUS_CORNER[CONTINUOUS_CORNER.length - 1])}`,
  ];
  for (const corner of corners) {
    const [start, ...curves] = CONTINUOUS_CORNER;
    commands.push(`L${point(corner, start)}`);
    for (let i = 0; i < curves.length; i += 3) {
      commands.push(
        `C${curves
          .slice(i, i + 3)
          .map((p) => point(corner, p))
          .join(" ")}`,
      );
    }
  }
  return `${commands.join("")}Z`;
}

export const IPHONE_SCREEN: PhoneScreen = {
  logicalWidth(screenshotWidth) {
    const logicalWidth = screenshotWidth / IPHONE_SCREENSHOT_SCALE;
    if (!Number.isInteger(logicalWidth)) {
      throw new Error(
        `The screenshot width ${screenshotWidth} is not a multiple of ${IPHONE_SCREENSHOT_SCALE}`,
      );
    }
    return logicalWidth;
  },
  outlinePath: screenOutlinePath,
};
