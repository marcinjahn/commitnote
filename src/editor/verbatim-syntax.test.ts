import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { isVerbatimPosition, VERBATIM_NODE_NAMES } from "./verbatim-syntax";

function verbatimAtCaret(docWithCaret: string): boolean {
  const pos = docWithCaret.indexOf("|");
  const state = EditorState.create({
    doc: docWithCaret.slice(0, pos) + docWithCaret.slice(pos + 1),
    extensions: markdown({ base: markdownLanguage }),
  });
  return isVerbatimPosition(state, pos);
}

describe("VERBATIM_NODE_NAMES", () => {
  it("names the code and URL nodes", () => {
    expect([...VERBATIM_NODE_NAMES].sort()).toEqual([
      "Autolink",
      "CodeBlock",
      "FencedCode",
      "InlineCode",
      "URL",
    ]);
  });
});

describe("isVerbatimPosition", () => {
  it.each([
    ["plain text", "Hello wor|ld", false],
    ["the end of a code span's content", "a `b|`", true],
    ["just after a closing backtick", "a `b`|", false],
    ["just before an opening backtick", "|`b`", false],
    ["just after an opening backtick", "`|b`", true],
    ["an unclosed code span", "a `b|", false],
    ["an unclosed fenced block's content", "```\ncode|", true],
    ["an unclosed fenced block's blank line", "```\n|", true],
    ["a closed fenced block's content", "```\nco|de\n```", true],
    ["a fenced block's info string", "```j|s\ncode\n```", true],
    ["the end of a fenced block's info string", "```js|\ncode\n```", true],
    ["just after a lone opening fence", "```|", true],
    ["just after a closing fence", "```\ncode\n```|", false],
    ["indented code", "    co|de", true],
    ["the end of indented code", "    code|", true],
    ["the end of a bare URL", "see https://a.c|", true],
    ["just after an autolink", "<https://a.com>|", false],
    ["inside an autolink", "<https://a.c|om>", true],
    ["a link destination", "[label](ht|tp://x)", true],
    ["a link label", "[la|bel](http://x)", false],
    ["just after a link", "[label](http://x)|", false],
  ])("at %s (%s) gives %s", (_case, doc, verbatim) => {
    expect(verbatimAtCaret(doc)).toBe(verbatim);
  });
});
