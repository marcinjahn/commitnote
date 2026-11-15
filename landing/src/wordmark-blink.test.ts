import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CARET_BLINK_MS,
  CARET_HOLD_MS,
  CARET_SOFT_EDGE_EASING,
  CARET_SOFT_EDGE_MS,
} from "../../src/editor/caret-style";
import { createTypingSchedule } from "../../src/ui/wordmark/typing-schedule";
import {
  type CssRule,
  declarations,
  stripComments,
  topLevelRules,
} from "./css-test-utils";

function rules(relativePath: string): CssRule[] {
  return topLevelRules(
    stripComments(readFileSync(new URL(relativePath, import.meta.url), "utf8")),
  );
}

function rule(list: CssRule[], prelude: string): CssRule {
  const found = list.find((candidate) => candidate.prelude === prelude);
  if (!found) throw new Error(`No "${prelude}" rule`);
  return found;
}

const landing = rules("./styles.css");
const motion = topLevelRules(
  rule(landing, "@media (prefers-reduced-motion: no-preference)").body,
);

function blinkAnimation(): string[] {
  const animation = declarations(
    rule(motion, ":root[data-motion] .hero-wordmark").body,
  ).get("animation");
  if (!animation) throw new Error("The hero wordmark has no animation");
  return animation.split(" ");
}

function lastKeystrokeMs(): number {
  const times = motion.flatMap((candidate) => {
    const at = declarations(candidate.body).get("--type-at");
    return at ? [parseFloat(at)] : [];
  });
  return Math.max(...times);
}

describe("landing wordmark blink", () => {
  it("blinks with the app's caret cadence and stops after the app's toggles", () => {
    const toggles = createTypingSchedule("commitnote", 6).caretToggles.length;
    expect(blinkAnimation()).toEqual([
      "wordmark-blink",
      `${2 * CARET_BLINK_MS}ms`,
      CARET_SOFT_EDGE_EASING,
      `${lastKeystrokeMs() + CARET_HOLD_MS}ms`,
      `${toggles / 2}`,
      "forwards",
    ]);
  });

  it("fades the caret and its tail out and back in over CARET_SOFT_EDGE_MS", () => {
    const edge = (100 * CARET_SOFT_EDGE_MS) / (2 * CARET_BLINK_MS);
    const stops = topLevelRules(
      rule(landing, "@keyframes wordmark-blink").body,
    );
    expect(
      stops.map((stop) => [
        parseFloat(stop.prelude),
        Number(declarations(stop.body).get("--wordmark-tail")),
      ]),
    ).toEqual([
      [0, 1],
      [edge, 0],
      [50, 0],
      [50 + edge, 1],
      [100, 1],
    ]);
  });

  it("registers --wordmark-tail exactly as the app does", () => {
    const prelude = "@property --wordmark-tail";
    expect(declarations(rule(landing, prelude).body)).toEqual(
      declarations(rule(rules("../../src/app.css"), prelude).body),
    );
  });
});
