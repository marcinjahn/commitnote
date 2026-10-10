import { describe, expect, test } from "vitest";
import source from "./NoteTreeFolder.svelte?raw";

const ACTIVE_STATES = /\.(unsynced|saving|sweeping)\b/;

function labelRules(): { selector: string; body: string }[] {
  const css = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1].trim(), body: match[2] }))
    .filter(({ selector }) => selector.includes(".tree-row-label"));
}

function idleRule(selector: string): string {
  const rule = labelRules().find(
    (candidate) => candidate.selector === selector,
  );
  expect(rule, selector).toBeDefined();
  return rule!.body;
}

describe("idle tree row labels stay cheap to scroll", () => {
  test("an idle label is not promoted to its own layer", () => {
    const body = idleRule(".tree-row-label");
    expect(body).not.toMatch(/will-change\s*:/);
    expect(body).not.toMatch(/(?<![-\w])transform\s*:/);
  });

  test("only labels in a sync state carry will-change", () => {
    const promoting = labelRules().filter(({ body }) =>
      /will-change\s*:\s*(?!auto)/.test(body),
    );
    expect(promoting.length).toBeGreaterThan(0);
    for (const { selector } of promoting) {
      for (const part of selector.split(",")) {
        expect(part, selector).toMatch(ACTIVE_STATES);
      }
    }
  });

  test("an idle label renders no masked name copy", () => {
    expect(idleRule(".tree-row-label::after")).toMatch(/content\s*:\s*none/);
    const drawing = labelRules().filter(({ body }) =>
      /content\s*:\s*attr\(data-name\)/.test(body),
    );
    expect(drawing.length).toBeGreaterThan(0);
    for (const { selector } of drawing) {
      for (const part of selector.split(",")) {
        expect(part, selector).toMatch(ACTIVE_STATES);
      }
    }
  });
});
