import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { declarations, stripComments, topLevelRules } from "./css-test-utils";

const SHARED_TOKENS = [
  "--color-background",
  "--color-surface",
  "--color-surface-raised",
  "--color-text",
  "--color-text-muted",
  "--color-accent",
  "--color-on-accent",
  "--color-link",
  "--color-ink",
  "--color-ink-hover",
  "--color-on-ink",
  "--color-hover",
  "--color-border",
  "--color-border-strong",
  "--radius",
  "--hairline",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--font-sans",
  "--font-mono",
  "--font-size-xs",
  "--font-size-sm",
  "--font-size-base",
  "--font-size-lg",
  "--font-size-xl",
  "--font-weight-medium",
  "--font-weight-semibold",
  "--letter-spacing-tight",
  "--letter-spacing-tighter",
  "--letter-spacing-caps",
  "--line-height",
  "--motion-duration",
  "--motion-easing",
] as const;

function readCss(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function resolveAccentFallbacks(value: string): string {
  return value.replace(/var\(--accent-(?:light|dark), ([^)]+)\)/g, "$1");
}

function tokenMismatches(
  expected: ReadonlyMap<string, string>,
  actual: ReadonlyMap<string, string>,
  names: Iterable<string>,
): string[] {
  const mismatches: string[] = [];
  for (const name of names) {
    const want = expected.get(name);
    const got = actual.get(name);
    if (want === undefined || got === undefined || want !== got) {
      mismatches.push(
        `${name}: app ${want ?? "missing"}, landing ${got ?? "missing"}`,
      );
    }
  }
  return mismatches;
}

function appTokens(): Map<string, string> {
  const rules = topLevelRules(stripComments(readCss("../../src/app.css")));
  const colorRule = rules.find((rule) =>
    /^:root,\s*\.color-scheme-scope$/.test(rule.prelude),
  );
  const scaleRule = rules.find(
    (rule) => rule.prelude === ":root" && rule.body.includes("--space-1:"),
  );
  if (!colorRule || !scaleRule)
    throw new Error("Token rules not found in app.css");
  const tokens = new Map([
    ...declarations(colorRule.body),
    ...declarations(scaleRule.body),
  ]);
  for (const [name, value] of tokens) {
    tokens.set(name, resolveAccentFallbacks(value));
  }
  return tokens;
}

function landingTokens(): Map<string, string> {
  const rules = topLevelRules(stripComments(readCss("./styles.css")));
  const rootRule = rules.find((rule) => rule.prelude === ":root");
  if (!rootRule) throw new Error("No :root rule in the landing stylesheet");
  return declarations(rootRule.body);
}

describe("landing tokens", () => {
  const app = appTokens();
  const landing = landingTokens();

  it("declares every shared token in the first :root rule", () => {
    const missing = SHARED_TOKENS.filter((name) => !landing.has(name));
    expect(missing).toEqual([]);
  });

  it("copies every shared token with the app's value", () => {
    expect(tokenMismatches(app, landing, SHARED_TOKENS)).toEqual([]);
  });

  it("declares no other unprefixed token than the app's", () => {
    const own = [...landing.keys()].filter(
      (name) => name.startsWith("--") && !name.startsWith("--landing-"),
    );
    expect(tokenMismatches(app, landing, own)).toEqual([]);
  });

  it("reports a token whose value differs from the app", () => {
    const mutated = new Map(landing).set("--space-3", "17px");
    expect(tokenMismatches(app, mutated, ["--space-3"])).toEqual([
      "--space-3: app 16px, landing 17px",
    ]);
  });
});
