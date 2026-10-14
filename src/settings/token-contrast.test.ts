import { describe, expect, test } from "vitest";
import appCss from "../app.css?raw";
import { ACCENT_PALETTE, type AccentColorId } from "./accent-palette";
import {
  compositeOver,
  contrastRatio,
  mixSrgb,
  parseHex,
  type Rgba,
} from "./color-contrast";

type Mode = "light" | "dark";

interface ContrastExclusion {
  finding: string;
  pair: string;
  modes?: Mode[];
  accents?: AccentColorId[];
  backgrounds?: string[];
}

const CONTRAST_EXCLUSIONS: readonly ContrastExclusion[] = [];

const MODES: readonly Mode[] = ["light", "dark"];
const ACCENTS = ACCENT_PALETTE.filter((option) => option.id !== "system");
const TEXT = 4.5;
const NON_TEXT = 3;
const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function topLevelRules(css: string): { prelude: string; body: string }[] {
  const rules: { prelude: string; body: string }[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        rules.push({
          prelude: css.slice(preludeStart, bodyStart - 1).trim(),
          body: css.slice(bodyStart, i),
        });
        preludeStart = i + 1;
      }
    }
  }
  return rules;
}

function declarations(body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    result.set(match[1], match[2].replace(/\s+/g, " ").trim());
  }
  return result;
}

const appRules = topLevelRules(stripComments(appCss));
const tokenRule = appRules.find((rule) =>
  /^:root,\s*\.color-scheme-scope$/.test(rule.prelude),
);
const focusRule = appRules.find(
  (rule) => rule.prelude === ":root" && rule.body.includes("--color-focus:"),
);
if (!tokenRule || !focusRule) throw new Error("Token blocks not found in app.css");

const TOKENS = new Map([
  ...declarations(tokenRule.body),
  ...declarations(focusRule.body),
]);

function splitArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "(") depth++;
    else if (args[i] === ")") depth--;
    else if (args[i] === "," && depth === 0) {
      parts.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(args.slice(start).trim());
  return parts;
}

interface Scope {
  mode: Mode;
  accent: Record<string, string>;
}

function resolveValue(value: string, scope: Scope, token: string): Rgba {
  const text = value.trim();
  if (text.startsWith("#")) return parseHex(text);
  if (text === "transparent") return TRANSPARENT;
  const call = /^([a-z-]+)\(([\s\S]*)\)$/.exec(text);
  if (call) {
    const [, fn, inner] = call;
    const args = splitArgs(inner);
    if (fn === "light-dark" && args.length === 2) {
      return resolveValue(args[scope.mode === "light" ? 0 : 1], scope, token);
    }
    if (fn === "var" && args.length >= 1 && args.length <= 2) {
      const name = args[0];
      const direct = scope.accent[name] ?? TOKENS.get(name);
      if (direct !== undefined) return resolveValue(direct, scope, name);
      if (args.length === 2) return resolveValue(args[1], scope, token);
    }
    if (fn === "color-mix" && args.length === 3 && args[0] === "in srgb") {
      const first = /^(.+)\s+(\d+(?:\.\d+)?)%$/.exec(args[1]);
      if (first) {
        return mixSrgb(
          resolveValue(first[1], scope, token),
          Number(first[2]),
          resolveValue(args[2], scope, token),
        );
      }
    }
  }
  throw new Error(`Unsupported colour syntax in ${token}: ${text}`);
}

function resolveToken(name: string, scope: Scope): Rgba {
  const value = TOKENS.get(name);
  if (value === undefined) throw new Error(`Unknown token ${name}`);
  return resolveValue(value, scope, name);
}

function dangerBorderValue(): string {
  const rule = appRules.find((candidate) => candidate.prelude === ".button-danger");
  const match = rule && /border-color:\s*([^;]+);/.exec(rule.body);
  if (!match) throw new Error(".button-danger border-color not found");
  return match[1].replace(/\s+/g, " ").trim();
}

const DANGER_BORDER = dangerBorderValue();

interface Probe {
  mode: Mode;
  accent: AccentColorId;
  color: (name: string) => Rgba;
  value: (css: string, label: string) => Rgba;
}

function probe(mode: Mode, accent: (typeof ACCENTS)[number]): Probe {
  const scope: Scope = {
    mode,
    accent: { "--accent-light": accent.light, "--accent-dark": accent.dark },
  };
  return {
    mode,
    accent: accent.id,
    color: (name) => resolveToken(name, scope),
    value: (css, label) => resolveValue(css, scope, label),
  };
}

type Backgrounds = Record<string, (p: Probe) => Rgba>;

const surfaces: Backgrounds = {
  background: (p) => p.color("--color-background"),
  surface: (p) => p.color("--color-surface"),
  "surface-raised": (p) => p.color("--color-surface-raised"),
};

interface Pair {
  id: string;
  threshold: number;
  foreground: (p: Probe) => Rgba;
  backgrounds: Backgrounds;
}

const pick = (source: Backgrounds, ...labels: string[]): Backgrounds =>
  Object.fromEntries(labels.map((label) => [label, source[label]]));

const token = (name: string) => (p: Probe) => p.color(name);

const PAIRS: Pair[] = [
  { id: "text-on-surfaces", threshold: TEXT, foreground: token("--color-text"), backgrounds: surfaces },
  { id: "muted-on-surfaces", threshold: TEXT, foreground: token("--color-text-muted"), backgrounds: surfaces },
  {
    id: "text-on-selected",
    threshold: TEXT,
    foreground: token("--color-text"),
    backgrounds: { "selected-accent": token("--color-selected-accent") },
  },
  {
    id: "muted-on-selected",
    threshold: TEXT,
    foreground: token("--color-text-muted"),
    backgrounds: { "selected-accent": token("--color-selected-accent") },
  },
  {
    id: "muted-on-hover",
    threshold: TEXT,
    foreground: token("--color-text-muted"),
    backgrounds: { "hover-accent": token("--color-hover-accent") },
  },
  {
    id: "danger-text",
    threshold: TEXT,
    foreground: token("--color-danger"),
    backgrounds: {
      ...pick(surfaces, "background", "surface-raised"),
      "danger-surface": token("--color-danger-surface"),
    },
  },
  {
    id: "warning-text",
    threshold: TEXT,
    foreground: token("--color-warning"),
    backgrounds: {
      ...pick(surfaces, "background"),
      "warning-surface": token("--color-warning-surface"),
    },
  },
  {
    id: "search-mark",
    threshold: TEXT,
    foreground: token("--color-text"),
    backgrounds: {
      "accent-over-surface-raised": (p) =>
        compositeOver(
          mixSrgb(p.color("--color-accent"), 30, TRANSPARENT),
          p.color("--color-surface-raised"),
        ),
    },
  },
  {
    id: "border-strong",
    threshold: NON_TEXT,
    foreground: token("--color-border-strong"),
    backgrounds: pick(surfaces, "background", "surface"),
  },
  {
    id: "danger-button-border",
    threshold: NON_TEXT,
    foreground: (p) =>
      compositeOver(
        p.value(DANGER_BORDER, ".button-danger border-color"),
        p.color("--color-danger-surface"),
      ),
    backgrounds: pick(surfaces, "background", "surface"),
  },
  ...["success", "info", "warning", "error"].map(
    (tone): Pair => ({
      id: `tone-rail-${tone}`,
      threshold: NON_TEXT,
      foreground: token(`--color-tone-${tone}`),
      backgrounds: pick(surfaces, "surface-raised"),
    }),
  ),
  { id: "focus", threshold: NON_TEXT, foreground: token("--color-focus"), backgrounds: surfaces },
];

interface ContrastCase {
  name: string;
  pair: string;
  background: string;
  mode: Mode;
  accent: AccentColorId;
  threshold: number;
  measure: () => number;
}

const CASES: ContrastCase[] = [];
for (const mode of MODES) {
  for (const accent of ACCENTS) {
    const p = probe(mode, accent);
    for (const pair of PAIRS) {
      for (const [background, resolve] of Object.entries(pair.backgrounds)) {
        CASES.push({
          name: `${pair.id} | ${mode} | ${accent.id} | ${background}`,
          pair: pair.id,
          background,
          mode,
          accent: accent.id,
          threshold: pair.threshold,
          measure: () => contrastRatio(pair.foreground(p), resolve(p)),
        });
      }
    }
  }
}

function matches(exclusion: ContrastExclusion, c: ContrastCase): boolean {
  return (
    exclusion.pair === c.pair &&
    (!exclusion.modes || exclusion.modes.includes(c.mode)) &&
    (!exclusion.accents || exclusion.accents.includes(c.accent)) &&
    (!exclusion.backgrounds || exclusion.backgrounds.includes(c.background))
  );
}

describe("token contrast", () => {
  test.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const ratio = c.measure();
    const exclusion = CONTRAST_EXCLUSIONS.find((candidate) => matches(candidate, c));
    if (exclusion) {
      expect(
        ratio,
        `fixed — delete the ${exclusion.finding} exclusion (ratio ${ratio.toFixed(2)})`,
      ).toBeLessThan(c.threshold);
    } else {
      expect(ratio, `ratio ${ratio.toFixed(2)} below ${c.threshold}`).toBeGreaterThanOrEqual(
        c.threshold,
      );
    }
  });

  test.each(CONTRAST_EXCLUSIONS.map((e) => [`${e.finding} ${e.pair}`, e] as const))(
    "exclusion %s matches at least one case",
    (_name, exclusion) => {
      expect(CASES.some((c) => matches(exclusion, c))).toBe(true);
    },
  );
});
