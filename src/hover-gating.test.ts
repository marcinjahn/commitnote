import { expect, test } from "vitest";

const sources = import.meta.glob("./**/*.{svelte,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function styles(path: string, text: string): string {
  if (path.endsWith(".css")) return text;
  return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join("\n");
}

function ungatedHoverSelectors(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const offenders: string[] = [];
  const atRules: string[] = [];
  let prelude = "";
  for (const char of source) {
    if (char === "{") {
      const text = prelude.trim();
      if (text.startsWith("@")) {
        atRules.push(text);
      } else {
        atRules.push("");
        const gated = atRules.some(
          (rule) => rule.startsWith("@media") && rule.includes("hover: hover"),
        );
        if (text.includes(":hover") && !gated) offenders.push(text);
      }
      prelude = "";
    } else if (char === "}") {
      atRules.pop();
      prelude = "";
    } else if (char === ";") {
      prelude = "";
    } else {
      prelude += char;
    }
  }
  return offenders;
}

test("every :hover rule is gated on (hover: hover)", () => {
  const offenders = Object.entries(sources).flatMap(([path, text]) =>
    ungatedHoverSelectors(styles(path, text)).map(
      (selector) => `${path}: ${selector}`,
    ),
  );
  expect(Object.keys(sources).length).toBeGreaterThan(50);
  expect(offenders).toEqual([]);
});
