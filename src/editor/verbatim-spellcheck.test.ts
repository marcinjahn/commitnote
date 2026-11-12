// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";

const TEXT = [
  "Prose paragraph with `inline` code and https://bare.example/path link",
  "",
  "An <https://auto.example> autolink and [label](https://dest.example) link",
  "",
  "```",
  "fenced body",
  "```",
  "",
  "    indented body",
].join("\n");

let editor: MarkdownEditor | null = null;

function mount(text = TEXT): MarkdownEditor {
  editor = createMarkdownEditor({
    parent: document.body,
    text,
    readOnly: false,
    onChange: () => {},
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
});

function textNodeContaining(root: Node, fragment: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.includes(fragment)) return node as Text;
  }
  throw new Error(`no text node contains ${fragment}`);
}

function insideSpellcheckOff(editor: MarkdownEditor, fragment: string): boolean {
  const { contentDOM } = editor.view;
  for (
    let node: Node | null = textNodeContaining(contentDOM, fragment);
    node && node !== contentDOM;
    node = node.parentNode
  ) {
    if (node instanceof Element && node.getAttribute("spellcheck") === "false")
      return true;
  }
  return false;
}

describe("verbatim spellcheck", () => {
  it.each([
    ["an inline code span", "inline"],
    ["a bare URL", "bare.example"],
    ["an autolink", "auto.example"],
    ["a link destination", "dest.example"],
    ["a fenced code block", "fenced body"],
    ["an indented code block", "indented body"],
  ])("disables spellcheck inside %s", (_name, fragment) => {
    expect(insideSpellcheckOff(mount(), fragment)).toBe(true);
  });

  it.each(["Prose paragraph", "autolink and", "label"])(
    "leaves prose %j to the spell checker",
    (fragment) => {
      expect(insideSpellcheckOff(mount(), fragment)).toBe(false);
    },
  );

  it("marks a code span added by an edit", () => {
    const { view } = mount("plain words\n");
    expect(insideSpellcheckOff(editor!, "plain words")).toBe(false);
    view.dispatch({ changes: { from: 0, insert: "`typed` " } });
    expect(insideSpellcheckOff(editor!, "typed")).toBe(true);
    expect(insideSpellcheckOff(editor!, "plain words")).toBe(false);
  });
});
