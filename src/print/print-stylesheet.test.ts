import { describe, expect, it } from "vitest";
import { PRINT_STYLE } from "../native-core/print-document";
import { PRINT_VIEW_STYLE } from "../ui/print/print-style";
import source from "./print-stylesheet.ts?raw";
import { printStylesheet } from "./print-stylesheet";

const SAMPLE = {
  root: ".sample-root",
  bodyFont: "BodyFont, serif",
  monoFont: "MonoFont, monospace",
  pageMargin: "7mm",
};

const CORE_OPTIONS = {
  root: ".print-view",
  bodyFont: '"commitnote-note", -apple-system, system-ui, sans-serif',
  monoFont: "ui-monospace, Menlo, monospace",
  pageMargin: "16mm",
};

const WEB_OPTIONS = {
  root: ".print-view",
  bodyFont: "var(--font-note)",
  monoFont: "var(--font-mono)",
  pageMargin: "18mm",
};

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function ruleBlocks(css: string): { selectors: string[]; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? "").split(",").map((selector) => selector.trim()),
    body: match[2] ?? "",
  }));
}

describe("printStylesheet", () => {
  const css = printStylesheet(SAMPLE);

  it("puts the page margin in @page", () => {
    expect(css).toContain("@page { margin: 7mm; }");
  });

  it("puts the body font in the root rule", () => {
    const rule = ruleBlocks(css).find((block) =>
      block.selectors.includes(".sample-root"),
    );
    expect(rule?.body).toContain("font-family: BodyFont, serif;");
  });

  it("puts the mono font in the code rule", () => {
    const rule = ruleBlocks(css).find((block) =>
      block.selectors.includes(".sample-root code"),
    );
    expect(rule?.body).toContain("font-family: MonoFont, monospace;");
    expect(css).not.toContain("ui-monospace");
  });

  it("prefixes every selector with the root", () => {
    const selectors = ruleBlocks(css)
      .flatMap((block) => block.selectors)
      .filter((selector) => !selector.startsWith("@page"));
    expect(selectors.length).toBeGreaterThan(20);
    for (const selector of selectors) {
      expect(selector.startsWith(".sample-root")).toBe(true);
    }
  });
});

describe("PRINT_STYLE", () => {
  it("contains the stylesheet with the core parameters exactly once", () => {
    expect(occurrences(PRINT_STYLE, printStylesheet(CORE_OPTIONS))).toBe(1);
  });
});

describe("PRINT_VIEW_STYLE", () => {
  it("wraps the stylesheet with the web parameters in @media print exactly once", () => {
    const sheet = printStylesheet(WEB_OPTIONS);
    expect(occurrences(PRINT_VIEW_STYLE, sheet)).toBe(1);
    expect(PRINT_VIEW_STYLE.startsWith("@media print {")).toBe(true);
    expect(PRINT_VIEW_STYLE.trimEnd().endsWith("}")).toBe(true);
  });
});

describe("print-stylesheet module", () => {
  it("imports nothing and touches no DOM global", () => {
    expect(source).not.toMatch(/\bimport\b/);
    expect(source).not.toMatch(/\b(document|window|navigator)\b/);
  });
});
