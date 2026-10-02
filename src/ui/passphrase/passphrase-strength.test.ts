import { describe, expect, it } from "vitest";
import {
  describeStrength,
  loadStrengthChecker,
  strengthUserInputs,
} from "./passphrase-strength";

describe("describeStrength", () => {
  it("labels scores 0 to 4", () => {
    expect([0, 1, 2, 3, 4].map((s) => describeStrength(s).label)).toEqual([
      "Weak",
      "Weak",
      "Fair",
      "Good",
      "Strong",
    ]);
  });

  it("fills one to four segments and flags only weak scores", () => {
    expect([0, 1, 2, 3, 4].map((s) => describeStrength(s).filledSegments)).toEqual([
      1, 1, 2, 3, 4,
    ]);
    expect([0, 1, 2, 3, 4].map((s) => describeStrength(s).weak)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("strengthUserInputs", () => {
  it("uses owner, repo and the app name", () => {
    expect(strengthUserInputs("sample/notes")).toEqual([
      "sample",
      "notes",
      "commitnote",
    ]);
  });
});

describe("passphrase strength checker", () => {
  it("rates a common password as weak with a warning", async () => {
    const check = await loadStrengthChecker();
    const result = check("password", []);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.warning).not.toBe("");
  });

  it("rates five random words as good or better", async () => {
    const check = await loadStrengthChecker();
    expect(
      check("violet anchor pepper tundra kayak", []).score,
    ).toBeGreaterThanOrEqual(3);
  });

  it("penalises the repository name", async () => {
    const check = await loadStrengthChecker();
    const plain = check("sample notes commitnote", []).score;
    const informed = check(
      "sample notes commitnote",
      strengthUserInputs("sample/notes"),
    ).score;
    expect(informed).toBeLessThanOrEqual(plain);
  });

  it("memoises the loader", async () => {
    expect(await loadStrengthChecker()).toBe(await loadStrengthChecker());
  });
});
