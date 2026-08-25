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
