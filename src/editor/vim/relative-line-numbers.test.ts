// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { forceParsing } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownEditorExtensions } from "../create-markdown-editor";
import { livePreview } from "../live-preview";
import {
  relativeLineLabel,
  relativeLineNumbers,
} from "./relative-line-numbers";

describe("relativeLineLabel", () => {
  it.each([
    [5, 5, "5"],
    [1, 1, "1"],
    [4, 5, "1"],
    [1, 5, "4"],
    [6, 5, "1"],
    [12, 5, "7"],
  ])("labels line %i with the cursor on %i as %s", (line, cursor, label) => {
    expect(relativeLineLabel(line, cursor)).toBe(label);
  });
});

const DOC = [
  "# Title",
  "",
  "- [ ] task",
  "> quote",
  "```ts",
  "code",
  "```",
  "---",
].join("\n");

describe("relativeLineNumbers", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  function mount(doc: string): EditorView {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [
          markdownEditorExtensions(),
          livePreview(),
          relativeLineNumbers(),
        ],
      }),
    });
    forceParsing(view, view.state.doc.length, 5000);
    return view;
  }

  function elements(editor: EditorView): HTMLElement[] {
    return Array.from(
      editor.dom.querySelectorAll<HTMLElement>(
        ".cm-relative-line-numbers .cm-gutterElement",
      ),
    ).filter((el) => el.style.visibility !== "hidden");
  }

  const labels = (editor: EditorView) =>
    elements(editor).map((el) => el.textContent);

  it("numbers every document line relative to the cursor", () => {
    const editor = mount(DOC);

    expect(labels(editor)).toEqual(["1", "1", "2", "3", "4", "5", "6", "7"]);
  });

  it("updates labels when the cursor moves", () => {
    const editor = mount(DOC);
    editor.dispatch({ selection: { anchor: editor.state.doc.line(4).from } });

    expect(labels(editor)).toEqual(["3", "2", "1", "4", "1", "2", "3", "4"]);
    const current = elements(editor).filter((el) =>
      el.classList.contains("cm-relative-line-current"),
    );
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("4");
  });

  it("marks heading lines with their level", () => {
    const editor = mount("# One\n## Two\n### Three\n#### Four\nplain");

    const classes = elements(editor).map((el) =>
      Array.from(el.classList).find((c) => /^cm-relative-line-h\d$/.test(c)),
    );
    expect(classes).toEqual([
      "cm-relative-line-h1",
      "cm-relative-line-h2",
      "cm-relative-line-h3",
      "cm-relative-line-h4",
      undefined,
    ]);
  });

  it("marks task lines only", () => {
    const editor = mount("plain\n- [ ] open\n- [x] done\n- item");

    expect(
      elements(editor).map((el) =>
        el.classList.contains("cm-relative-line-task"),
      ),
    ).toEqual([false, true, true, false]);
  });

  it("sizes the spacer for the line count with a two character minimum", () => {
    const editor = mount(DOC);
    const spacer = editor.dom.querySelector<HTMLElement>(
      ".cm-relative-line-numbers .cm-gutterElement[style*='hidden']",
    );
    expect(spacer?.textContent).toBe("99");

    editor.dispatch({
      changes: {
        from: editor.state.doc.length,
        insert: "\n".repeat(100),
      },
    });
    const wider = editor.dom.querySelector<HTMLElement>(
      ".cm-relative-line-numbers .cm-gutterElement[style*='hidden']",
    );
    expect(wider?.textContent).toBe("999");
  });
});
