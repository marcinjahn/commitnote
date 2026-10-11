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
