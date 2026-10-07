// @vitest-environment jsdom
import { undo } from "@codemirror/commands";
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";
import { pasteLinkChange } from "./paste-link";

let current: { editor: MarkdownEditor; parent: HTMLElement } | null = null;

function setup(
  text: string,
  selection: { anchor: number; head?: number },
  readOnly = false,
): MarkdownEditor {
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

function paste(editor: MarkdownEditor, value: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? value : "") },
  });
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

function selectWord(text: string, word: string): MarkdownEditor {
  const from = text.indexOf(word);
  return setup(text, { anchor: from, head: from + word.length });
}

afterEach(() => {
  current?.editor.destroy();
  current?.parent.remove();
  current = null;
});

describe("pasteLink", () => {
  it("turns the selection into a link and puts the caret after it", () => {
    const editor = selectWord("see word here", "word");
    const event = paste(editor, "https://example.com/a");
    expect(event.defaultPrevented).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(
      "see [word](https://example.com/a) here",
    );
    const caret = "see [word](https://example.com/a)".length;
    expect(editor.view.state.selection.main.anchor).toBe(caret);
    expect(editor.view.state.selection.main.empty).toBe(true);
  });

  it.each([
    ["www.example.org", "[word](https://www.example.org)"],
    ["WWW.Example.org", "[word](https://WWW.Example.org)"],
    ["me@example.com", "[word](mailto:me@example.com)"],
    ["mailto:me@example.com", "[word](mailto:me@example.com)"],
    ["http://example.com", "[word](http://example.com)"],
    ["  https://example.com/x\n", "[word](https://example.com/x)"],
    [
      "https://example.com/a_(b)",
      "[word](<https://example.com/a_(b)>)",
    ],
  ])("pasting %j produces %s", (pasted, expected) => {
    const editor = selectWord("word", "word");
    paste(editor, pasted);
    expect(editor.view.state.doc.toString()).toBe(expected);
  });

  it("escapes square brackets in the selection", () => {
    const editor = selectWord("a [b c", "[b");
    paste(editor, "https://example.com");
    expect(editor.view.state.doc.toString()).toBe(
      "a [\\[b](https://example.com) c",
    );
  });

  it("is undone in one step", () => {
    const editor = selectWord("see word here", "word");
    paste(editor, "https://example.com");
    undo(editor.view);
    expect(editor.view.state.doc.toString()).toBe("see word here");
  });

  const untouched: [string, () => MarkdownEditor, string][] = [
    ["an empty selection", () => setup("word", { anchor: 2 }), "https://a.com"],
    [
      "a multi-line selection",
      () => setup("one\ntwo", { anchor: 1, head: 5 }),
      "https://a.com",
    ],
    [
      "multiple ranges",
      () => {
        const editor = setup("one two", { anchor: 0, head: 3 });
        editor.view.dispatch({
          selection: EditorSelection.create([
            EditorSelection.range(0, 3),
            EditorSelection.range(4, 7),
          ]),
        });
        return editor;
      },
      "https://a.com",
    ],
    [
      "inner whitespace",
      () => selectWord("word", "word"),
      "https://a.com b",
    ],
    ["non-URL text", () => selectWord("word", "word"), "hello"],
    ["an ftp URL", () => selectWord("word", "word"), "ftp://example.com"],
    [
      "a javascript URL",
      () => selectWord("word", "word"),
      "javascript:alert(1)",
    ],
    ["angle brackets", () => selectWord("word", "word"), "https://a.com/<x>"],
    [
      "inline code",
      () => selectWord("a `code` b", "code"),
      "https://a.com",
    ],
    [
      "a fenced code block",
      () => selectWord("```\ncode\n```", "code"),
      "https://a.com",
    ],
    [
      "an existing link",
      () => selectWord("[label](https://x.com)", "label"),
      "https://a.com",
    ],
    [
      "a read-only editor",
      () => setup("word", { anchor: 0, head: 4 }, true),
      "https://a.com",
    ],
  ];

  it.each(untouched)("leaves the paste alone for %s", (_name, make, pasted) => {
    const editor = make();
    expect(pasteLinkChange(editor.view.state, pasted)).toBeNull();
    paste(editor, pasted);
    expect(editor.view.state.doc.toString()).not.toContain(`](${pasted}`);
  });
});
