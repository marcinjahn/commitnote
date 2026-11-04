// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { forceParsing } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownEditorExtensions } from "../create-markdown-editor";
import { livePreview } from "../live-preview";
import { tableWidgets } from "../table-widgets";
import {
  alignTableLineNumbers,
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

const TABLE_DOC = [
  "first",
  "second",
  "third",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "after",
].join("\n");

describe("relativeLineNumbers beside rendered tables", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  function mount(line: number, readOnly = false): EditorView {
    const state = EditorState.create({
      doc: TABLE_DOC,
      extensions: [
        markdownEditorExtensions(),
        tableWidgets(),
        relativeLineNumbers(),
        EditorState.readOnly.of(readOnly),
      ],
    });
    view = new EditorView({
      parent: document.body,
      state: state.update({
        selection: { anchor: state.doc.line(line).from },
      }).state,
    });
    forceParsing(view, view.state.doc.length, 5000);
    return view;
  }

  const tableNumbers = (editor: EditorView) =>
    Array.from(
      editor.dom.querySelectorAll<HTMLElement>(
        ".cm-relative-line-numbers .cm-table-line-numbers",
      ),
    );

  const tableLabels = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll<HTMLElement>(".cm-table-line-number"),
      (label) => label.textContent,
    );

  const lineLabels = (editor: EditorView) =>
    Array.from(
      editor.dom.querySelectorAll<HTMLElement>(
        ".cm-relative-line-numbers .cm-gutterElement",
      ),
    )
      .filter((el) => el.style.visibility !== "hidden")
      .map((el) => el.textContent);

  it("numbers every source line of a rendered table", () => {
    const editor = mount(1);

    const containers = tableNumbers(editor);
    expect(containers).toHaveLength(1);
    expect(tableLabels(containers[0])).toEqual(["4", "5", "6"]);
    expect(lineLabels(editor)).toEqual(["1", "1", "2", "3", "456", "7", "8"]);
  });

  it("updates the table labels when the cursor moves", () => {
    const editor = mount(1);
    editor.dispatch({ selection: { anchor: editor.state.doc.line(9).from } });

    const containers = tableNumbers(editor);
    expect(containers).toHaveLength(1);
    expect(tableLabels(containers[0])).toEqual(["4", "3", "2"]);
  });

  it("marks the cursor line inside a read-only rendered table", () => {
    const editor = mount(6, true);

    const containers = tableNumbers(editor);
    expect(containers).toHaveLength(1);
    expect(tableLabels(containers[0])).toEqual(["1", "6", "1"]);
    const current = Array.from(
      containers[0].querySelectorAll(".cm-table-line-number"),
      (label) => label.classList.contains("cm-relative-line-current"),
    );
    expect(current).toEqual([false, true, false]);
  });

  it("uses ordinary line numbers once the table is revealed", () => {
    const editor = mount(6);

    expect(tableNumbers(editor)).toHaveLength(0);
    expect(lineLabels(editor)).toEqual([
      "5",
      "4",
      "3",
      "2",
      "1",
      "6",
      "1",
      "2",
      "3",
    ]);
  });
});

describe("alignTableLineNumbers", () => {
  it("aligns the header and body labels to their rows", () => {
    expect(alignTableLineNumbers([10, 60, 100], 4, 20)).toEqual([
      10, 30, 60, 100,
    ]);
  });

  it("stacks the delimiter label right under the header", () => {
    expect(alignTableLineNumbers([8, 70], 3, 24)).toEqual([8, 32, 70]);
  });

  it("pushes a label down when the previous one would overlap", () => {
    expect(alignTableLineNumbers([0, 30, 35], 4, 20)).toEqual([0, 20, 40, 60]);
  });

  it("returns null when the rows do not match the source lines", () => {
    expect(alignTableLineNumbers([0, 30], 4, 20)).toBeNull();
    expect(alignTableLineNumbers([], 1, 20)).toBeNull();
  });
});
