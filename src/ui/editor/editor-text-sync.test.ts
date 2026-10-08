import { describe, expect, it } from "vitest";
import { decideEditorTextSync } from "./editor-text-sync";

const same = { noteSwitch: 1, appliedSwitch: 1, text: "b", doc: "a", base: "a" };

describe("decideEditorTextSync", () => {
  it("replaces the document on a note switch, even over typed text", () => {
    expect(decideEditorTextSync({ ...same, noteSwitch: 2, doc: "typed" })).toBe("set");
  });

  it("accepts the text when the engine caught up with the document", () => {
    expect(decideEditorTextSync({ ...same, text: "a", doc: "a", base: "x" })).toBe("accept");
  });

  it("updates in place when the document is untouched since the last engine text", () => {
    expect(decideEditorTextSync(same)).toBe("update");
  });

  it("skips when the user typed since the last engine text", () => {
    expect(decideEditorTextSync({ ...same, doc: "a!" })).toBe("skip");
  });
});
