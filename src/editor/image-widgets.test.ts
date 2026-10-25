import { describe, expect, it } from "vitest";
import {
  EditorSelection,
  EditorState,
  type EditorStateConfig,
} from "@codemirror/state";
import { markdownEditorExtensions } from "./create-markdown-editor";
import { ImageWidget, imageWidgets, imageWidgetsField } from "./image-widgets";

const ID = "abcdefghijklmnopqrstuvwxyz";
const OTHER_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const REF = `![Cat](image:${ID}#800x600)`;

function stateFor(
  doc: string,
  selection: EditorStateConfig["selection"] = EditorSelection.cursor(
    doc.length,
  ),
): EditorState {
  return EditorState.create({
    doc,
    selection,
    extensions: [markdownEditorExtensions(), imageWidgets()],
  });
}

interface Found {
  readonly widgets: Array<{ pos: number; widget: ImageWidget }>;
  readonly hidden: Array<[number, number]>;
}

function decorations(state: EditorState): Found {
  const widgets: Found["widgets"] = [];
  const hidden: Found["hidden"] = [];
  state
    .field(imageWidgetsField)
    .between(0, state.doc.length, (from, to, deco) => {
      const widget: unknown = deco.spec.widget;
      if (widget instanceof ImageWidget) {
        expect(deco.spec.block).toBe(true);
        widgets.push({ pos: from, widget });
      } else {
        hidden.push([from, to]);
      }
    });
  return { widgets, hidden };
}

describe("imageWidgetsField", () => {
  it("places a block widget at the end of the reference line and hides the reference off the active line", () => {
    const doc = `Intro ${REF} tail\nnext line`;
    const refFrom = doc.indexOf("!");
    const { widgets, hidden } = decorations(stateFor(doc));

    expect(widgets).toHaveLength(1);
    expect(widgets[0]?.pos).toBe(doc.indexOf("\n"));
    expect(widgets[0]?.widget.imageId).toBe(ID);
    expect(widgets[0]?.widget.alt).toBe("Cat");
    expect(widgets[0]?.widget.width).toBe(800);
    expect(widgets[0]?.widget.height).toBe(600);
    expect(hidden).toEqual([[refFrom, refFrom + REF.length]]);
  });

  it("shows the reference text when the cursor or a selection touches its line", () => {
    const doc = `before\n${REF}\nafter`;
    const lineStart = doc.indexOf("!");
    const lineEnd = lineStart + REF.length;

    expect(
      decorations(stateFor(doc, EditorSelection.cursor(lineStart))).hidden,
    ).toEqual([]);
    expect(
      decorations(stateFor(doc, EditorSelection.cursor(lineEnd))).hidden,
    ).toEqual([]);
    expect(
      decorations(stateFor(doc, EditorSelection.range(0, lineStart))).hidden,
    ).toEqual([]);
    expect(
      decorations(stateFor(doc, EditorSelection.cursor(0))).hidden,
    ).toHaveLength(1);
    expect(
      decorations(stateFor(doc, EditorSelection.cursor(0))).widgets,
    ).toHaveLength(1);
  });

  it("treats a reference spanning two lines as active from either line", () => {
    const doc = `top\n![a long\ncaption](image:${ID})\nbottom`;
    const from = doc.indexOf("!");
    const to = doc.indexOf(")") + 1;
    const secondLine = doc.indexOf("caption");

    const away = decorations(stateFor(doc, EditorSelection.cursor(0)));
    expect(away.hidden).toEqual([[from, to]]);
    expect(away.widgets.map((w) => w.pos)).toEqual([to]);
    expect(away.widgets[0]?.widget.alt).toBe("a long\ncaption");

    expect(
      decorations(stateFor(doc, EditorSelection.cursor(from + 2))).hidden,
    ).toEqual([]);
    expect(
      decorations(stateFor(doc, EditorSelection.cursor(secondLine))).hidden,
    ).toEqual([]);
  });

  it("gives several references on one line several widgets in document order", () => {
    const doc = `${REF} ![Dog](image:${OTHER_ID})\n`;
    const { widgets, hidden } = decorations(stateFor(doc));

    expect(widgets.map((w) => w.widget.imageId)).toEqual([ID, OTHER_ID]);
    expect(widgets.map((w) => w.pos)).toEqual([
      doc.indexOf("\n"),
      doc.indexOf("\n"),
    ]);
    expect(hidden).toHaveLength(2);
  });

  it("unescapes the alt text and leaves dimensions undefined without a size", () => {
    const { widgets } = decorations(stateFor(`![a \\[b\\]](image:${ID})\n`));
    expect(widgets[0]?.widget.alt).toBe("a [b]");
    expect(widgets[0]?.widget.width).toBeUndefined();
    expect(widgets[0]?.widget.height).toBeUndefined();
  });

  it.each([
    ["an https image", `![x](https://example.com/a.png)`],
    ["an invalid id", `![x](image:ABC)`],
    ["a link", `[x](image:${ID})`],
    ["inline code", `\`${REF}\``],
    ["a fenced code block", `\`\`\`\n${REF}\n\`\`\``],
    ["an indented code block", `para\n\n    ${REF}`],
  ])("adds nothing for %s", (_name, doc) => {
    const { widgets, hidden } = decorations(stateFor(`${doc}\n`));
    expect(widgets).toEqual([]);
    expect(hidden).toEqual([]);
  });

  it("follows edits and selection changes", () => {
    let state = stateFor("text\nmore", EditorSelection.cursor(0));
    expect(decorations(state).widgets).toEqual([]);

    state = state.update({
      changes: { from: state.doc.length, insert: `\n${REF}` },
    }).state;
    expect(decorations(state).widgets).toHaveLength(1);
    expect(decorations(state).hidden).toHaveLength(1);

    state = state.update({ selection: { anchor: state.doc.length } }).state;
    expect(decorations(state).hidden).toEqual([]);
  });
});

describe("ImageWidget.eq", () => {
  it("compares id, alt and dimensions", () => {
    const widget = new ImageWidget(ID, "Cat", 800, 600);
    expect(widget.eq(new ImageWidget(ID, "Cat", 800, 600))).toBe(true);
    expect(widget.eq(new ImageWidget(OTHER_ID, "Cat", 800, 600))).toBe(false);
    expect(widget.eq(new ImageWidget(ID, "Dog", 800, 600))).toBe(false);
    expect(widget.eq(new ImageWidget(ID, "Cat", 801, 600))).toBe(false);
    expect(widget.eq(new ImageWidget(ID, "Cat", 800, 601))).toBe(false);
    expect(widget.eq(new ImageWidget(ID, "Cat"))).toBe(false);
  });

  it("estimates the height from the dimensions", () => {
    expect(new ImageWidget(ID, "", 800, 200).estimatedHeight).toBe(216);
    expect(new ImageWidget(ID, "", 800, 2000).estimatedHeight).toBe(376);
    expect(new ImageWidget(ID, "").estimatedHeight).toBe(176);
  });
});
