// @vitest-environment jsdom
import { undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";
import { insertLink, toggleInlineMarker } from "./format-keymap";

let current: { editor: MarkdownEditor; parent: HTMLElement } | null = null;

type Sel = { anchor: number; head?: number };

function setup(text: string, selection: Sel, readOnly = false): MarkdownEditor {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const editor = createMarkdownEditor({
    parent,
    text,
    readOnly,
    onChange: () => {},
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  editor.view.dispatch({
    selection: EditorSelection.single(selection.anchor, selection.head),
  });
  current = { editor, parent };
  return editor;
}

function selectWord(text: string, word: string): MarkdownEditor {
  const from = text.indexOf(word);
  return setup(text, { anchor: from, head: from + word.length });
}

function press(
  editor: MarkdownEditor,
  key: string,
  shiftKey = false,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    keyCode: key.toUpperCase().charCodeAt(0),
    ctrlKey: true,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

function doc(editor: MarkdownEditor): string {
  return editor.view.state.doc.toString();
}

function selected(editor: MarkdownEditor): string {
  const { from, to } = editor.view.state.selection.main;
  return editor.view.state.sliceDoc(from, to);
}

afterEach(() => {
  current?.editor.destroy();
  current?.parent.remove();
  current = null;
});

const MARKERS = [
  { name: "bold", key: "b", shift: false, marker: "**" },
  { name: "italic", key: "i", shift: false, marker: "*" },
  { name: "strikethrough", key: "x", shift: true, marker: "~~" },
];

describe.each(MARKERS)("$name shortcut", ({ key, shift, marker }) => {
  it("wraps the selection and keeps it on the same text", () => {
    const editor = selectWord("a word b", "word");
    const event = press(editor, key, shift);
    expect(event.defaultPrevented).toBe(true);
    expect(doc(editor)).toBe(`a ${marker}word${marker} b`);
    expect(selected(editor)).toBe("word");
  });

  it("removes markers inside the selection", () => {
    const editor = selectWord(`a ${marker}word${marker} b`, `${marker}word${marker}`);
    press(editor, key, shift);
    expect(doc(editor)).toBe("a word b");
    expect(selected(editor)).toBe("word");
  });

  it("removes markers just outside the selection", () => {
    const editor = selectWord(`a ${marker}word${marker} b`, "word");
    press(editor, key, shift);
    expect(doc(editor)).toBe("a word b");
    expect(selected(editor)).toBe("word");
  });

  it("inserts the pair with the caret between for an empty selection", () => {
    const editor = setup("ab", { anchor: 1 });
    press(editor, key, shift);
    expect(doc(editor)).toBe(`a${marker}${marker}b`);
    expect(editor.view.state.selection.main.head).toBe(1 + marker.length);
  });

  it("leaves a multi-line range unchanged", () => {
    const editor = setup("one\ntwo", { anchor: 1, head: 6 });
    const event = press(editor, key, shift);
    expect(event.defaultPrevented).toBe(true);
    expect(doc(editor)).toBe("one\ntwo");
  });

  it("leaves a range inside inline code unchanged", () => {
    const editor = selectWord("a `word` b", "word");
    press(editor, key, shift);
    expect(doc(editor)).toBe("a `word` b");
  });

  it("leaves a range inside a code block unchanged", () => {
    const editor = selectWord("```\nword\n```", "word");
    press(editor, key, shift);
    expect(doc(editor)).toBe("```\nword\n```");
  });

  it("formats link text", () => {
    const editor = selectWord("[word](https://x.y)", "word");
    press(editor, key, shift);
    expect(doc(editor)).toBe(`[${marker}word${marker}](https://x.y)`);
  });

  it("formats several ranges in one undo step", () => {
    const editor = setup("aa bb", { anchor: 0 });
    editor.view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(0, 2),
        EditorSelection.range(3, 5),
      ]),
    });
    press(editor, key, shift);
    expect(doc(editor)).toBe(`${marker}aa${marker} ${marker}bb${marker}`);
    undo(editor.view);
    expect(doc(editor)).toBe("aa bb");
  });

  it("changes nothing in a read-only editor but consumes the key", () => {
    const editor = setup("a word b", { anchor: 2, head: 6 }, true);
    const event = press(editor, key, shift);
    expect(event.defaultPrevented).toBe(true);
    expect(doc(editor)).toBe("a word b");
  });
});

describe("italic versus bold", () => {
  it("wraps bold text into bold italic", () => {
    const editor = selectWord("a **word** b", "word");
    press(editor, "i");
    expect(doc(editor)).toBe("a ***word*** b");
  });

  it("removes only the italic marker from bold italic", () => {
    const editor = selectWord("a ***word*** b", "word");
    press(editor, "i");
    expect(doc(editor)).toBe("a **word** b");
  });

  it("removes only the italic marker inside a selected bold italic", () => {
    const editor = selectWord("a ***word*** b", "***word***");
    press(editor, "i");
    expect(doc(editor)).toBe("a **word** b");
  });

  it("bold removes only bold from bold italic", () => {
    const editor = selectWord("a ***word*** b", "word");
    press(editor, "b");
    expect(doc(editor)).toBe("a *word* b");
  });
});

describe("link shortcut", () => {
  it("wraps the selection with the caret inside the parentheses", () => {
    const editor = selectWord("a word b", "word");
    const event = press(editor, "k");
    expect(event.defaultPrevented).toBe(true);
    expect(doc(editor)).toBe("a [word]() b");
    expect(editor.view.state.selection.main.head).toBe("a [word](".length);
  });

  it("escapes square brackets in the label", () => {
    const editor = selectWord("a x] b", "x]");
    press(editor, "k");
    expect(doc(editor)).toBe("a [x\\]]() b");
  });

  it("inserts an empty link with the caret in the label", () => {
    const editor = setup("ab", { anchor: 1 });
    press(editor, "k");
    expect(doc(editor)).toBe("a[]()b");
    expect(editor.view.state.selection.main.head).toBe(2);
  });

  it("leaves a selection overlapping a link unchanged", () => {
    const editor = selectWord("[word](https://x.y)", "word");
    press(editor, "k");
    expect(doc(editor)).toBe("[word](https://x.y)");
  });

  it("leaves a selection overlapping a bare URL unchanged", () => {
    const editor = selectWord("see https://x.y now", "https://x.y");
    press(editor, "k");
    expect(doc(editor)).toBe("see https://x.y now");
  });

  it("leaves a multi-line range and inline code unchanged", () => {
    const multi = setup("one\ntwo", { anchor: 1, head: 6 });
    press(multi, "k");
    expect(doc(multi)).toBe("one\ntwo");
    multi.destroy();
    const code = selectWord("a `word` b", "word");
    press(code, "k");
    expect(doc(code)).toBe("a `word` b");
  });

  it("changes nothing in a read-only editor but consumes the key", () => {
    const editor = setup("a word b", { anchor: 2, head: 6 }, true);
    const event = press(editor, "k");
    expect(event.defaultPrevented).toBe(true);
    expect(doc(editor)).toBe("a word b");
  });

  it("does not insert a link on the shifted chord", () => {
    const editor = setup("one\ntwo", { anchor: 1 });
    press(editor, "K", true);
    expect(doc(editor)).not.toContain("[]()");
  });
});

describe("builders", () => {
  it("return null for a read-only state", () => {
    const state = EditorState.create({
      doc: "word",
      selection: { anchor: 0, head: 4 },
      extensions: [EditorState.readOnly.of(true)],
    });
    expect(toggleInlineMarker(state, "**")).toBeNull();
    expect(insertLink(state)).toBeNull();
  });
});
