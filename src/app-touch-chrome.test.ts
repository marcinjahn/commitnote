import { describe, expect, test } from "vitest";
import appCss from "./app.css?raw";

function ruleBody(prelude: RegExp): string {
  const match = appCss.match(
    new RegExp(`(?:^|\\n)${prelude.source}\\s*\\{([^}]*)\\}`),
  );
  expect(match, `rule ${prelude}`).not.toBeNull();
  return match![1];
}

describe("touch chrome", () => {
  test("html suppresses the tap highlight", () => {
    expect(ruleBody(/html,\s*body/)).toMatch(
      /-webkit-tap-highlight-color:\s*transparent/,
    );
  });

  test("buttons skip the double-tap delay and are not selectable", () => {
    const body = ruleBody(/button,\s*\.button/);
    expect(body).toMatch(/touch-action:\s*manipulation/);
    expect(body).toMatch(/(?<!-webkit-)user-select:\s*none/);
    expect(body).toMatch(/-webkit-touch-callout:\s*none/);
  });
});
