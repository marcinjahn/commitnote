import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { buildConflictDecorations } from "./conflict-highlight";
import { CONFLICT_MARKERS } from "../merge/merge-text";

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
  it("marks conflict marker lines and the mine/theirs regions between them", () => {
    const doc = [
      "before",
      CONFLICT_MARKERS.mine,
      "mine line",
      CONFLICT_MARKERS.separator,
      "theirs line",
      CONFLICT_MARKERS.theirs,
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

  it("does not treat a line merely containing the separator text as a marker", () => {
    const doc = `foo ${CONFLICT_MARKERS.separator} bar`;
    const state = EditorState.create({ doc });

    let count = 0;
    buildConflictDecorations(state).between(0, state.doc.length, () => {
      count += 1;
    });

    expect(count).toBe(0);
  });
});
