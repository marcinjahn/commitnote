// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import {
  createMarkdownEditor,
  markdownEditorExtensions,
} from "./create-markdown-editor";

function continueMarkup(doc: string): string {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: markdownEditorExtensions(),
  });
  let result = state;
  insertNewlineContinueMarkup({
    state,
    dispatch: (tr) => {
      result = tr.state;
    },
  });
  return result.doc.toString();
}

describe("createMarkdownEditor", () => {
  it("uses the initial text as the document", () => {
    const parent = document.createElement("div");
    const editor = createMarkdownEditor({
      parent,
      text: "# Title",
      readOnly: false,
      onChange: () => {},
    });

    expect(editor.view.state.doc.toString()).toBe("# Title");
    editor.destroy();
  });

  it("fires onChange with the exact text for a user-originated edit", () => {
    const changes: string[] = [];
    const parent = document.createElement("div");
    const editor = createMarkdownEditor({
      parent,
      text: "hello",
      readOnly: false,
      onChange: (text) => changes.push(text),
    });

    editor.view.dispatch({
      changes: { from: 5, insert: " world" },
      userEvent: "input.type",
    });

    expect(changes).toEqual(["hello world"]);
    editor.destroy();
  });

  it("setText replaces the document without firing onChange", () => {
    const changes: string[] = [];
    const parent = document.createElement("div");
    const editor = createMarkdownEditor({
      parent,
      text: "hello",
      readOnly: false,
      onChange: (text) => changes.push(text),
    });

    editor.setText("goodbye");

    expect(editor.view.state.doc.toString()).toBe("goodbye");
    expect(changes).toEqual([]);
    editor.destroy();
  });

  it("setReadOnly(true) makes the state read-only", () => {
    const parent = document.createElement("div");
    const editor = createMarkdownEditor({
      parent,
      text: "hello",
      readOnly: false,
      onChange: () => {},
    });

    editor.setReadOnly(true);

    expect(editor.view.state.readOnly).toBe(true);
    editor.destroy();
  });

  describe("describedBy", () => {
    function create(readOnly: boolean, describedBy?: string) {
      const parent = document.createElement("div");
      const editor = createMarkdownEditor({
        parent,
        text: "hello",
        readOnly,
        onChange: () => {},
        describedBy,
      });
      return editor;
    }

    it("points the editable content at the description", () => {
      const editor = create(false, "hint");
      expect(editor.view.contentDOM.getAttribute("aria-describedby")).toBe(
        "hint",
      );
      editor.destroy();
    });

    it("leaves a read-only editor without a description", () => {
      const editor = create(true, "hint");
      expect(editor.view.contentDOM.hasAttribute("aria-describedby")).toBe(
        false,
      );
      editor.destroy();
    });

    it("adds and removes the description when read-only toggles", () => {
      const editor = create(false, "hint");
      editor.setReadOnly(true);
      expect(editor.view.contentDOM.hasAttribute("aria-describedby")).toBe(
        false,
      );
      editor.setReadOnly(false);
      expect(editor.view.contentDOM.getAttribute("aria-describedby")).toBe(
        "hint",
      );
      editor.destroy();
    });

    it("sets no description when none is given", () => {
      const editor = create(false);
      expect(editor.view.contentDOM.hasAttribute("aria-describedby")).toBe(
        false,
      );
      editor.destroy();
    });
  });

  it("setSelection sets the main selection, clamped to the document", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createMarkdownEditor({
      parent,
      text: "hello",
      readOnly: false,
      onChange: () => {},
    });

    editor.setSelection(1, 3);
    expect(editor.getSelection()).toEqual({ anchor: 1, head: 3 });

    editor.setSelection(-4, 40);
    expect(editor.getSelection()).toEqual({ anchor: 0, head: 5 });
    expect(editor.view.hasFocus).toBe(false);
    editor.destroy();
    parent.remove();
  });

  it("destroy removes the editor from the DOM", () => {
    const parent = document.createElement("div");
    const editor = createMarkdownEditor({
      parent,
      text: "hello",
      readOnly: false,
      onChange: () => {},
    });

    expect(parent.childElementCount).toBeGreaterThan(0);

    editor.destroy();

    expect(parent.childElementCount).toBe(0);
  });

  it("does not reformat list markers or emphasis characters while typing", () => {
    const changes: string[] = [];
    const parent = document.createElement("div");
    const editor = createMarkdownEditor({
      parent,
      text: "",
      readOnly: false,
      onChange: (text) => changes.push(text),
    });

    editor.view.dispatch({
      changes: { from: 0, insert: "*a*" },
      userEvent: "input.type",
    });
    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: "\n+ item" },
      userEvent: "input.type",
    });

    expect(changes).toEqual(["*a*", "*a*\n+ item"]);
    editor.destroy();
  });

  it("does not restore the previous document when undoing after setText", () => {
    const onChange = vi.fn();
    const editor = createMarkdownEditor({
      parent: document.createElement("div"),
      text: "A",
      readOnly: false,
      onChange,
    });

    editor.setText("");
    undo(editor.view);

    expect(editor.view.state.doc.toString()).toBe("");
    expect(onChange).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("undoes typing within the current document", () => {
    const editor = createMarkdownEditor({
      parent: document.createElement("div"),
      text: "",
      readOnly: false,
      onChange: () => {},
    });

    editor.view.dispatch({
      changes: { from: 0, insert: "abc" },
      userEvent: "input.type",
    });
    undo(editor.view);

    expect(editor.view.state.doc.toString()).toBe("");
    editor.destroy();
  });

  describe("markdown keymap continuation", () => {
    it("continues a bullet list item", () => {
      expect(continueMarkup("- item")).toBe("- item\n- ");
    });

    it("continues a task list item", () => {
      expect(continueMarkup("- [ ] task")).toBe("- [ ] task\n- [ ] ");
    });

    it("continues a block quote", () => {
      expect(continueMarkup("> quote")).toBe("> quote\n> ");
    });

    it("continues an ordered list, incrementing the marker", () => {
      expect(continueMarkup("1. one")).toBe("1. one\n2. ");
    });
  });
});
