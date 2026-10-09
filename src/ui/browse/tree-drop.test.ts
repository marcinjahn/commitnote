import { describe, expect, it } from "vitest";
import type { NotePath } from "../../changes/change";
import {
  hitTestDrop,
  hitTestNoteArea,
  hitTestTrashArea,
  type DropRow,
  type DropScene,
} from "./tree-drop";

const ROW_HEIGHT = 40;
const INDENT_START = 8;
const INDENT_STEP = 24;

// A, F/ (expanded: x, G/ (expanded: y)), B, E/ (collapsed: z)
const CHILDREN = new Map<string, readonly string[]>([
  ["", ["A", "F", "B", "E"]],
  ["F", ["x", "G"]],
  ["F/G", ["y"]],
  ["E", ["z"]],
]);

const VISIBLE: readonly (readonly [NotePath, "note" | "folder"])[] = [
  [["A"], "note"],
  [["F"], "folder"],
  [["F", "x"], "note"],
  [["F", "G"], "folder"],
  [["F", "G", "y"], "note"],
  [["B"], "note"],
  [["E"], "folder"],
];

const ROWS: readonly DropRow[] = VISIBLE.map(([path, kind], index) => ({
  path,
  kind,
  top: index * ROW_HEIGHT,
  height: ROW_HEIGHT,
}));

function scene(
  dragged: NotePath,
  options: {
    conflicted?: boolean;
    children?: Map<string, readonly string[]>;
  } = {},
): DropScene {
  const children = options.children ?? CHILDREN;
  return {
    rows: ROWS,
    dragged,
    draggedKind: children.has(dragged.join("/")) ? "folder" : "note",
    conflicted: options.conflicted ?? false,
    childrenOf: (folder) => children.get(folder.join("/")),
    indentStart: INDENT_START,
    indentStep: INDENT_STEP,
  };
}

function rowY(index: number, fraction: number): number {
  return index * ROW_HEIGHT + fraction * ROW_HEIGHT;
}

function xAtDepth(depth: number): number {
  return INDENT_START + depth * INDENT_STEP + 4;
}

describe("hitTestDrop on a note row", () => {
  it("puts the item before the row in the upper half", () => {
    expect(hitTestDrop(scene(["E"]), xAtDepth(0), rowY(5, 0.3))).toEqual({
      kind: "drop",
      target: { parent: [], before: "B" },
      into: false,
      gapIndex: 5,
      depth: 0,
    });
  });

  it("puts the item after the row in the lower half", () => {
    expect(hitTestDrop(scene(["E"]), xAtDepth(0), rowY(0, 0.7))).toEqual({
      kind: "drop",
      target: { parent: [], before: "F" },
      into: false,
      gapIndex: 1,
      depth: 0,
    });
  });

  it("puts the item before a nested row inside that row's folder", () => {
    expect(hitTestDrop(scene(["A"]), xAtDepth(0), rowY(2, 0.2))).toEqual({
      kind: "drop",
      target: { parent: ["F"], before: "x" },
      into: false,
      gapIndex: 2,
      depth: 1,
    });
  });
});

describe("hitTestDrop on a folder row", () => {
  it("puts the item before the folder in its top quarter", () => {
    expect(hitTestDrop(scene(["A"]), xAtDepth(0), rowY(6, 0.2))).toEqual({
      kind: "drop",
      target: { parent: [], before: "E" },
      into: false,
      gapIndex: 6,
      depth: 0,
    });
  });

  it("puts the item into the folder in its middle half", () => {
    expect(hitTestDrop(scene(["A"]), xAtDepth(0), rowY(6, 0.5))).toEqual({
      kind: "drop",
      target: { parent: ["E"], before: null },
      into: true,
      gapIndex: -1,
      depth: 1,
    });
  });

  it("puts the item first in an expanded folder in its bottom quarter", () => {
    expect(hitTestDrop(scene(["A"]), xAtDepth(0), rowY(1, 0.8))).toEqual({
      kind: "drop",
      target: { parent: ["F"], before: "x" },
      into: false,
      gapIndex: 2,
      depth: 1,
    });
  });

  it("puts the item after a collapsed folder in its bottom quarter", () => {
    expect(hitTestDrop(scene(["A"]), xAtDepth(0), rowY(6, 0.8))).toEqual({
      kind: "drop",
      target: { parent: [], before: null },
      into: false,
      gapIndex: 7,
      depth: 0,
    });
  });
});

describe("hitTestDrop after the last row of a folder", () => {
  const belowY = rowY(4, 0.8);

  it("stays in the innermost folder when the pointer is at its depth", () => {
    expect(hitTestDrop(scene(["A"]), xAtDepth(2), belowY)).toMatchObject({
      target: { parent: ["F", "G"], before: null },
      gapIndex: 5,
      depth: 2,
    });
  });

  it("leaves one folder when the pointer is one level further left", () => {
    expect(hitTestDrop(scene(["A"]), xAtDepth(1), belowY)).toMatchObject({
      target: { parent: ["F"], before: null },
      gapIndex: 5,
      depth: 1,
    });
  });

  it("goes to the top level, before the next row, at depth 0", () => {
    expect(hitTestDrop(scene(["A"]), xAtDepth(0), belowY)).toMatchObject({
      target: { parent: [], before: "B" },
      gapIndex: 5,
      depth: 0,
    });
  });

  it("clamps a pointer left of depth 0 and right of the row's depth", () => {
    expect(hitTestDrop(scene(["A"]), 0, belowY)).toMatchObject({
      target: { parent: [], before: "B" },
      depth: 0,
    });
    expect(hitTestDrop(scene(["A"]), xAtDepth(5), belowY)).toMatchObject({
      target: { parent: ["F", "G"], before: null },
      depth: 2,
    });
  });

  it("ignores x between siblings at the same depth", () => {
    expect(hitTestDrop(scene(["A"]), xAtDepth(0), rowY(2, 0.8))).toMatchObject({
      target: { parent: ["F"], before: "G" },
      depth: 1,
    });
  });
});

describe("hitTestDrop below the rows", () => {
  it("puts the item last at the top level", () => {
    expect(hitTestDrop(scene(["F", "x"]), xAtDepth(2), rowY(9, 0))).toEqual({
      kind: "drop",
      target: { parent: [], before: null },
      into: false,
      gapIndex: 7,
      depth: 0,
    });
  });

  it("treats a pointer above the first row as before it", () => {
    expect(hitTestDrop(scene(["B"]), xAtDepth(0), -10)).toMatchObject({
      target: { parent: [], before: "A" },
      gapIndex: 0,
    });
  });
});

describe("hitTestDrop for drops that change nothing", () => {
  it("reports dropping a note onto its own row", () => {
    expect(hitTestDrop(scene(["B"]), xAtDepth(0), rowY(5, 0.3))).toEqual({
      kind: "unchanged",
    });
    expect(hitTestDrop(scene(["B"]), xAtDepth(0), rowY(5, 0.7))).toEqual({
      kind: "unchanged",
    });
  });

  it("reports dropping an item right after its previous sibling", () => {
    expect(hitTestDrop(scene(["F"]), xAtDepth(0), rowY(0, 0.7))).toEqual({
      kind: "unchanged",
    });
  });

  it("reports dropping the last item into its own folder", () => {
    expect(hitTestDrop(scene(["F", "G"]), xAtDepth(0), rowY(1, 0.5))).toEqual({
      kind: "unchanged",
    });
  });

  it("allows moving an earlier item to the end of its own folder", () => {
    expect(hitTestDrop(scene(["F", "x"]), xAtDepth(0), rowY(1, 0.5))).toEqual({
      kind: "drop",
      target: { parent: ["F"], before: null },
      into: true,
      gapIndex: -1,
      depth: 1,
    });
  });
});

describe("hitTestDrop for refused drops", () => {
  it("refuses a folder into itself", () => {
    expect(hitTestDrop(scene(["F"]), xAtDepth(0), rowY(1, 0.5))).toEqual({
      kind: "refused",
    });
  });

  it("refuses a folder into one of its descendants", () => {
    expect(hitTestDrop(scene(["F"]), xAtDepth(1), rowY(3, 0.5))).toEqual({
      kind: "refused",
    });
    expect(hitTestDrop(scene(["F"]), xAtDepth(1), rowY(2, 0.3))).toEqual({
      kind: "refused",
    });
  });

  it("lets a folder go after its own last descendant at its own depth", () => {
    expect(hitTestDrop(scene(["F"]), xAtDepth(0), rowY(4, 0.8))).toEqual({
      kind: "unchanged",
    });
    expect(hitTestDrop(scene(["A"]), xAtDepth(0), rowY(4, 0.8))).toMatchObject({
      kind: "drop",
    });
  });

  it("refuses a folder that already has an item of that name", () => {
    const children = new Map(CHILDREN);
    children.set("E", ["z", "A"]);
    expect(
      hitTestDrop(scene(["A"], { children }), xAtDepth(0), rowY(6, 0.5)),
    ).toEqual({ kind: "refused" });
  });

  it("refuses moving an item with a held conflict to another folder", () => {
    expect(
      hitTestDrop(
        scene(["A"], { conflicted: true }),
        xAtDepth(0),
        rowY(6, 0.5),
      ),
    ).toEqual({ kind: "refused" });
  });

  it("still lets an item with a held conflict move within its folder", () => {
    expect(
      hitTestDrop(
        scene(["A"], { conflicted: true }),
        xAtDepth(0),
        rowY(5, 0.7),
      ),
    ).toMatchObject({ kind: "drop", target: { parent: [], before: "E" } });
  });
});

describe("hitTestNoteArea", () => {
  const AREA = { left: 300, top: 0, right: 1000, bottom: 800 };

  it("opens a note dropped inside the area", () => {
    expect(hitTestNoteArea(AREA, "note", 600, 400)).toBe("open");
  });

  it("gives a folder over the area no target", () => {
    expect(hitTestNoteArea(AREA, "folder", 600, 400)).toBe("none");
  });

  it("is outside left of the area, on its right edge, or below it", () => {
    expect(hitTestNoteArea(AREA, "note", 299, 400)).toBe("outside");
    expect(hitTestNoteArea(AREA, "note", 1000, 400)).toBe("outside");
    expect(hitTestNoteArea(AREA, "note", 600, 800)).toBe("outside");
  });

  it("is outside when there is no area or it has no size", () => {
    expect(hitTestNoteArea(null, "note", 600, 400)).toBe("outside");
    expect(
      hitTestNoteArea({ left: 0, top: 0, right: 0, bottom: 0 }, "note", 0, 0),
    ).toBe("outside");
  });
});

describe("hitTestTrashArea", () => {
  const AREA = { left: 10, top: 20, right: 110, bottom: 60 };

  it("hits a point inside the area", () => {
    expect(hitTestTrashArea(AREA, 50, 40)).toBe(true);
  });

  it("misses points left of, above, right of and below the area", () => {
    expect(hitTestTrashArea(AREA, 9, 40)).toBe(false);
    expect(hitTestTrashArea(AREA, 50, 19)).toBe(false);
    expect(hitTestTrashArea(AREA, 111, 40)).toBe(false);
    expect(hitTestTrashArea(AREA, 50, 61)).toBe(false);
  });

  it("includes the left and top edges and excludes the right and bottom edges", () => {
    expect(hitTestTrashArea(AREA, 10, 20)).toBe(true);
    expect(hitTestTrashArea(AREA, 110, 40)).toBe(false);
    expect(hitTestTrashArea(AREA, 50, 60)).toBe(false);
  });

  it("misses when there is no area", () => {
    expect(hitTestTrashArea(null, 50, 40)).toBe(false);
  });

  it("misses when the area has no width or no height", () => {
    expect(
      hitTestTrashArea({ left: 10, top: 20, right: 10, bottom: 60 }, 10, 40),
    ).toBe(false);
    expect(
      hitTestTrashArea({ left: 10, top: 20, right: 110, bottom: 20 }, 50, 20),
    ).toBe(false);
  });
});
