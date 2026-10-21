import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { buildConflictDecorations } from "./conflict-highlight";
import { CONFLICT_MARKER_PREFIX } from "../merge/merge-text";

function classesByLine(state: EditorState): Map<number, string> {
  const classes = new Map<number, string>();
  buildConflictDecorations(state).between(
    0,
    state.doc.length,
    (from, _to, deco) => {
      classes.set(state.doc.lineAt(from).number, String(deco.spec.class));
    },
  );
  return classes;
}

describe("buildConflictDecorations", () => {
  it("marks labelled conflict marker lines and the mine/theirs regions between them", () => {
    const doc = [
      "before",
      `${CONFLICT_MARKER_PREFIX.mine} This device · Laptop`,
      "mine line",
      CONFLICT_MARKER_PREFIX.separator,
      "theirs line",
      `${CONFLICT_MARKER_PREFIX.theirs} Other device · Pixel app`,
      "after",
    ].join("\n");
    const state = EditorState.create({ doc });

    const classes = classesByLine(state);

    expect(classes.get(1)).toBeUndefined();
    expect(classes.get(2)).toBe("cm-conflict-marker");
    expect(classes.get(3)).toBe("cm-conflict-mine");
    expect(classes.get(4)).toBe("cm-conflict-marker");
    expect(classes.get(5)).toBe("cm-conflict-theirs");
    expect(classes.get(6)).toBe("cm-conflict-marker");
    expect(classes.get(7)).toBeUndefined();
  });

  it("still highlights old plain markers", () => {
    const doc = [
      "<<<<<<< mine",
      "mine line",
      "=======",
      "theirs line",
      ">>>>>>> theirs",
    ].join("\n");
    const state = EditorState.create({ doc });

    const classes = classesByLine(state);

    expect(classes.get(1)).toBe("cm-conflict-marker");
    expect(classes.get(2)).toBe("cm-conflict-mine");
    expect(classes.get(3)).toBe("cm-conflict-marker");
    expect(classes.get(4)).toBe("cm-conflict-theirs");
    expect(classes.get(5)).toBe("cm-conflict-marker");
  });

  it("does not treat a line merely containing the separator text as a marker", () => {
    const doc = `foo ${CONFLICT_MARKER_PREFIX.separator} bar`;
    const state = EditorState.create({ doc });

    let count = 0;
    buildConflictDecorations(state).between(0, state.doc.length, () => {
      count += 1;
    });

    expect(count).toBe(0);
  });
});
