import { describe, expect, it } from "vitest";
import { inputKindAttributes } from "./input-kind";

describe("inputKindAttributes", () => {
  it("turns keyboard assistance on for prose input", () => {
    expect(inputKindAttributes("prose")).toEqual({
      autocapitalize: "sentences",
      autocorrect: "on",
      spellcheck: "true",
    });
  });

  it("turns keyboard assistance off for verbatim input", () => {
    expect(inputKindAttributes("verbatim")).toEqual({
      autocapitalize: "off",
      autocorrect: "off",
      spellcheck: "false",
    });
  });
});
