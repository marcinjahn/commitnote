export type Rgba = { r: number; g: number; b: number; a: number };

export function parseHex(hex: string): Rgba {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a hex colour: ${hex}`);
  const digits =
    match[1].length === 3
      ? [...match[1]].map((digit) => digit + digit).join("")
      : match[1];
  const channel = (start: number) => parseInt(digits.slice(start, start + 2), 16);
  return { r: channel(0), g: channel(2), b: channel(4), a: 1 };
}

export function relativeLuminance({ r, g, b }: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(in srgb, A percentA%, B)`; `b` with zero alpha means `transparent`. */
export function mixSrgb(a: Rgba, percentA: number, b: Rgba): Rgba {
  const weight = percentA / 100;
  if (b.a === 0) return { ...a, a: a.a * weight };
  const mix = (x: number, y: number) => x * weight + y * (1 - weight);
  return {
    r: mix(a.r, b.r),
    g: mix(a.g, b.g),
    b: mix(a.b, b.b),
    a: mix(a.a, b.a),
  };
}

export function compositeOver(top: Rgba, bottom: Rgba): Rgba {
  const over = (x: number, y: number) => top.a * x + (1 - top.a) * y;
  return {
    r: over(top.r, bottom.r),
    g: over(top.g, bottom.g),
    b: over(top.b, bottom.b),
    a: 1,
  };
}

const toLinear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const toChannel = (linear: number) => {
  const value = Math.min(1, Math.max(0, linear));
  const encoded =
    value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return encoded * 255;
};

/** `oklch(from C min(l, bound) c h)` or `max(…)`, clipped to sRGB. */
export function clampOklchLightness(
  color: Rgba,
  clamp: "min" | "max",
  bound: number,
): Rgba {
  const [r, g, b] = [color.r, color.g, color.b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const L = clamp === "min" ? Math.min(lightness, bound) : Math.max(lightness, bound);
  const l3 = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m3 = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s3 = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: toChannel(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    g: toChannel(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    b: toChannel(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
    a: color.a,
  };
}
