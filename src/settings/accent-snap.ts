import {
  ACCENT_PALETTE,
  type AccentColorId,
  type AccentOption,
} from "./accent-palette";

export type PaletteColorId = Exclude<AccentColorId, "system">;

export interface SystemAccent {
  readonly id: PaletteColorId;
  readonly fromOs: boolean;
}

export const FALLBACK_SYSTEM_ACCENT: SystemAccent = {
  id: "blue",
  fromOs: false,
};

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

const NEUTRAL_MAX_CHROMA = 0.045;
const HUE_REFERENCE_CHROMA = 0.15;
const LIGHTNESS_WEIGHT = 0.2;
const CHROMA_WEIGHT = 0.2;

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const RGB_FUNCTION = new RegExp(
  String.raw`^rgba?\(\s*(${NUMBER})(%?)\s*[,\s]\s*(${NUMBER})(%?)\s*[,\s]\s*(${NUMBER})(%?)\s*(?:[,/]\s*${NUMBER}%?\s*)?\)$`,
  "i",
);
const SRGB_FUNCTION = new RegExp(
  String.raw`^color\(\s*srgb\s+(${NUMBER})\s+(${NUMBER})\s+(${NUMBER})\s*(?:/\s*${NUMBER}%?\s*)?\)$`,
  "i",
);
const HEX = /^#([0-9a-f]{6})$/i;

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, value));
}

export function parseCssColor(value: string): Rgb | null {
  const text = value.trim();
  const hex = HEX.exec(text);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  const rgb = RGB_FUNCTION.exec(text);
  if (rgb) {
    const channel = (number: string, percent: string) =>
      clampChannel(percent ? (Number(number) * 255) / 100 : Number(number));
    return {
      r: channel(rgb[1], rgb[2]),
      g: channel(rgb[3], rgb[4]),
      b: channel(rgb[5], rgb[6]),
    };
  }
  const srgb = SRGB_FUNCTION.exec(text);
  if (srgb) {
    return {
      r: clampChannel(Number(srgb[1]) * 255),
      g: clampChannel(Number(srgb[2]) * 255),
      b: clampChannel(Number(srgb[3]) * 255),
    };
  }
  return null;
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function toOklch({ r, g, b }: Rgb): Oklch {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(okA, okB),
    h: Math.atan2(okB, okA),
  };
}

// Hue difference is measured at a fixed chroma, so a muted color is matched
// by its hue as strongly as a vivid one.
function distance(a: Oklch, b: Oklch): number {
  const hue = 2 * HUE_REFERENCE_CHROMA * Math.sin((a.h - b.h) / 2);
  const lightness = LIGHTNESS_WEIGHT * (a.l - b.l);
  const chroma = CHROMA_WEIGHT * (a.c - b.c);
  return Math.hypot(hue, lightness, chroma);
}

interface Candidate {
  readonly id: PaletteColorId;
  readonly neutral: boolean;
  readonly variants: readonly Oklch[];
}

const CANDIDATES: readonly Candidate[] = (
  ACCENT_PALETTE as readonly AccentOption[]
).flatMap((option) => {
  const variants = [option.light, option.dark]
    .map((hex) => (hex === undefined ? null : parseCssColor(hex)))
    .filter((rgb) => rgb !== null)
    .map(toOklch);
  if (variants.length === 0) return [];
  return [
    {
      id: option.id as PaletteColorId,
      neutral: option.neutral === true,
      variants,
    },
  ];
});

export function nearestPaletteColor(color: Rgb): PaletteColorId {
  const target = toOklch(color);
  const neutral = target.c < NEUTRAL_MAX_CHROMA;
  const pool = CANDIDATES.filter((candidate) => candidate.neutral === neutral);
  let best: PaletteColorId = FALLBACK_SYSTEM_ACCENT.id;
  let bestDistance = Infinity;
  for (const candidate of pool) {
    for (const variant of candidate.variants) {
      const d = distance(target, variant);
      if (d < bestDistance) {
        bestDistance = d;
        best = candidate.id;
      }
    }
  }
  return best;
}

export function resolveSystemAccent(probe: string | null): SystemAccent {
  const color = probe === null ? null : parseCssColor(probe);
  if (color === null) return FALLBACK_SYSTEM_ACCENT;
  return { id: nearestPaletteColor(color), fromOs: true };
}
