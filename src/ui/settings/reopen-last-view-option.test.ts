import { describe, expect, it } from "vitest";
import { describeReopenLastViewUnavailable } from "./reopen-last-view-option";

describe("describeReopenLastViewUnavailable", () => {
  it("asks for Remember me in the browser", () => {
    expect(describeReopenLastViewUnavailable(false)).toBe(
      "Needs “Remember me” when you log in.",
    );
  });

  it("explains the device limit in the installed app", () => {
    expect(describeReopenLastViewUnavailable(true)).toBe(
      "Unavailable because this device can't keep you logged in.",
    );
  });
});
