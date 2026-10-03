import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdownEditorExtensions } from "./create-markdown-editor";
import { isOpenableUrl, linkUrlAt } from "./link-open";

function stateFor(doc: string): EditorState {
  return EditorState.create({ doc, extensions: markdownEditorExtensions() });
}

function at(doc: string, needle: string, offset = 0): string | null {
  return linkUrlAt(stateFor(doc), doc.indexOf(needle) + offset);
}

describe("linkUrlAt", () => {
  const inline = "see [text](https://a.example) end";

  it("resolves on link text", () => {
    expect(at(inline, "text", 1)).toBe("https://a.example");
  });

  it.each([
    ["[", 0],
    ["]", 0],
    ["(", 0],
    [")", 0],
  ])("resolves on %s", (mark, offset) => {
    const doc = inline;
    const pos = mark === "[" ? doc.indexOf("[") : doc.indexOf(mark);
    expect(linkUrlAt(stateFor(doc), pos + offset)).toBe("https://a.example");
  });

  it("resolves on the destination", () => {
    expect(at(inline, "https://a.example", 4)).toBe("https://a.example");
  });

  it("uses the destination for a URL-shaped label", () => {
    const doc = "[https://a.example](https://b.example)";
    expect(at(doc, "https://a.example", 3)).toBe("https://b.example");
    expect(at(doc, "https://b.example", 3)).toBe("https://b.example");
  });

  it("trims destination whitespace", () => {
    expect(at("[x]( https://a.example )", "https", 2)).toBe(
      "https://a.example",
    );
  });

  it("excludes the title", () => {
    expect(at('[x](https://a.example "t")', "x")).toBe("https://a.example");
    expect(at('[x](https://a.example "t")', '"t"', 1)).toBe(
      "https://a.example",
    );
  });

  it("resolves autolinks", () => {
    expect(at("<https://a.example>", "https", 3)).toBe("https://a.example");
  });

  it("resolves bare URLs", () => {
    expect(at("go https://a.example now", "https", 3)).toBe(
      "https://a.example",
    );
  });

  it("resolves mailto links", () => {
    expect(at("[mail](mailto:a@b.example)", "mail", 1)).toBe(
      "mailto:a@b.example",
    );
  });

  it("returns null for a reference link", () => {
    expect(at("[x][ref]\n\n[ref]: https://a.example", "x")).toBeNull();
  });

  it("returns null for an empty destination", () => {
    expect(at("[x]()", "x")).toBeNull();
  });

  it.each([
    ["relative", "[x](notes/a.md)"],
    ["javascript", "[x](javascript:alert(1))"],
    ["data", "[x](data:text/html,hi)"],
  ])("returns null for %s destination", (_, doc) => {
    expect(at(doc, "x")).toBeNull();
  });

  it("returns null for bare www and email", () => {
    expect(at("www.a.example", "www", 2)).toBeNull();
    expect(at("a@b.example", "a@b", 2)).toBeNull();
  });

  it("returns null outside any link", () => {
    expect(at("plain [x](https://a.example) text", "plain", 2)).toBeNull();
  });

  it("returns null for an empty doc", () => {
    expect(linkUrlAt(stateFor(""), 0)).toBeNull();
  });
});

describe("isOpenableUrl", () => {
  it.each(["http://a.example", "HTTPS://a.example", "mailto:a@b.example"])(
    "accepts %s",
    (url) => {
      expect(isOpenableUrl(url)).toBe(true);
    },
  );

  it.each(["", "www.a.example", "a@b.example", "notes/a.md", "javascript:1"])(
    "rejects %j",
    (url) => {
      expect(isOpenableUrl(url)).toBe(false);
    },
  );
});
