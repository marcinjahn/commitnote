import { describe, expect, it } from "vitest";
import { validateName } from "../../tree/note-names";
import { autoName } from "./auto-name";

describe("autoName", () => {
  it("zero-pads every field and uses a 24-hour clock", () => {
    expect(autoName(new Date(2026, 0, 5, 7, 3, 9), [])).toBe(
      "2026-01-05 07:03:09",
    );
    expect(autoName(new Date(2026, 11, 25, 23, 59, 58), [])).toBe(
      "2026-12-25 23:59:58",
    );
  });

  it("formats local time fields", () => {
    const now = new Date(2030, 5, 15, 13, 45, 30);
    expect(autoName(now, [])).toBe(
      `${now.getFullYear()}-06-15 ${now.getHours()}:45:30`,
    );
  });

  it("appends (2) when the base name is taken", () => {
    const now = new Date(2026, 0, 5, 7, 3, 9);
    expect(autoName(now, ["2026-01-05 07:03:09"])).toBe(
      "2026-01-05 07:03:09 (2)",
    );
  });

  it("keeps counting on repeated collisions", () => {
    const now = new Date(2026, 0, 5, 7, 3, 9);
    const siblings = ["2026-01-05 07:03:09", "2026-01-05 07:03:09 (2)"];
    expect(autoName(now, siblings)).toBe("2026-01-05 07:03:09 (3)");
  });

  it("returns a name accepted by validateName against the same siblings", () => {
    const now = new Date(2026, 0, 5, 7, 3, 9);
    const siblings = ["2026-01-05 07:03:09", "other"];
    const result = autoName(now, siblings);
    expect(validateName(result, siblings)).toEqual({ ok: true, name: result });
  });
});
