// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";
import {
  setVimStatus,
  vimStatusField,
  type VimEditingMode,
} from "./vim/vim-status";

const PROSE = {
  autocapitalize: "sentences",
  autocorrect: "on",
  spellcheck: "true",
};
const VERBATIM = {
  autocapitalize: "off",
  autocorrect: "off",
  spellcheck: "false",
};

const TEXT = [
  "Plain words and `code` here",
  "see https://a.com and <https://b.com> too",
  "```",
  "fenced",
  "```",
].join("\n");

function at(fragment: string, offset = 1): number {
  const index = TEXT.indexOf(fragment);
  if (index < 0) throw new Error(`missing fragment ${fragment}`);
  return index + offset;
}

function inputKindAttributesOf(editor: MarkdownEditor) {
  const content = editor.view.contentDOM;
  return {
    autocapitalize: content.getAttribute("autocapitalize"),
    autocorrect: content.getAttribute("autocorrect"),
    spellcheck: content.getAttribute("spellcheck"),
  };
}

describe("Note editor input kind", () => {
  let editor: MarkdownEditor;

  function mount(options: { readOnly?: boolean; vim?: boolean } = {}): void {
    editor = createMarkdownEditor({
      parent: document.body,
      text: TEXT,
      readOnly: options.readOnly ?? false,
      onChange: () => {},
      extensions: options.vim ? [vimStatusField] : [],
    });
    moveCaret(at("words"));
  }

  function moveCaret(pos: number): void {
    editor.setSelection(pos, pos);
  }

  afterEach(() => {
    editor.destroy();
  });

  it("gives prose input in prose, with writing suggestions and translation off", () => {
    mount();

    expect(inputKindAttributesOf(editor)).toEqual(PROSE);
    expect(editor.view.contentDOM.getAttribute("writingsuggestions")).toBe(
      "false",
    );
    expect(editor.view.contentDOM.getAttribute("translate")).toBe("no");
  });

  it.each([
    ["a code span", at("code")],
    ["a fenced code block", at("fenced")],
    ["a bare URL", at("https://a.com", 5)],
    ["an autolink", at("https://b.com", 5)],
  ])("gives verbatim input with the caret in %s", (_place, pos) => {
    mount();

    moveCaret(pos);
    expect(inputKindAttributesOf(editor)).toEqual(VERBATIM);
    expect(editor.view.contentDOM.getAttribute("writingsuggestions")).toBe(
      "false",
    );
    expect(editor.view.contentDOM.getAttribute("translate")).toBe("no");

    moveCaret(at("here"));
    expect(inputKindAttributesOf(editor)).toEqual(PROSE);
  });

  it("gives verbatim input while read-only and prose input once editable", () => {
    mount({ readOnly: true });
    expect(inputKindAttributesOf(editor)).toEqual(VERBATIM);

    editor.setReadOnly(false);
    expect(inputKindAttributesOf(editor)).toEqual(PROSE);

    editor.setReadOnly(true);
    expect(inputKindAttributesOf(editor)).toEqual(VERBATIM);
  });

  it.each<[VimEditingMode, typeof PROSE]>([
    ["normal", VERBATIM],
    ["visual", VERBATIM],
    ["visual-line", VERBATIM],
    ["replace", VERBATIM],
    ["insert", PROSE],
  ])("in Vim %s mode gives the matching input kind", (mode, expected) => {
    mount({ vim: true });

    editor.view.dispatch({ effects: setVimStatus.of({ mode }) });

    expect(inputKindAttributesOf(editor)).toEqual(expected);
  });

  it("gives verbatim input in Vim insert mode with the caret in code", () => {
    mount({ vim: true });
    editor.view.dispatch({ effects: setVimStatus.of({ mode: "insert" }) });

    moveCaret(at("code"));

    expect(inputKindAttributesOf(editor)).toEqual(VERBATIM);
  });

  describe("during a composition", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // CodeMirror reports `composing` only after it has read a DOM change
    // made between compositionstart and compositionend.
    async function startComposingAfter(fragment: string): Promise<void> {
      const { view } = editor;
      moveCaret(at(fragment, fragment.length));
      view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart"));
      const { node, offset } = view.domAtPos(view.state.selection.main.head);
      if (!(node instanceof Text)) throw new Error("caret is not in text");
      node.insertData(offset, "x");
      await vi.waitFor(() => expect(view.composing).toBe(true));
      expect(view.state.doc.toString()).toContain(`${fragment}x`);
    }

    it("keeps the attributes until the composition ends", async () => {
      mount();
      await startComposingAfter("here");

      moveCaret(at("code"));
      expect(inputKindAttributesOf(editor)).toEqual(PROSE);

      editor.view.contentDOM.dispatchEvent(
        new CompositionEvent("compositionend"),
      );
      await vi.runAllTimersAsync();

      expect(inputKindAttributesOf(editor)).toEqual(VERBATIM);
    });
  });
});
