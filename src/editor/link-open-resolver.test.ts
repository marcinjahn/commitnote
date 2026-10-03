import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdownEditorExtensions } from "./create-markdown-editor";
import { linkUrlAt, toOpenableUrl } from "./link-open";

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
    ["scheme-less non-www", "[x](a.example/p)"],
    ["javascript", "[x](javascript:alert(1))"],
    ["data", "[x](data:text/html,hi)"],
  ])("returns null for %s destination", (_, doc) => {
    expect(at(doc, "x")).toBeNull();
  });

  it("resolves a bare www URL to https", () => {
    expect(at("go www.a.example/p?q=1 now", "www", 2)).toBe(
      "https://www.a.example/p?q=1",
    );
  });

  it("excludes trailing punctuation from a bare www URL", () => {
    expect(at("see www.a.example.", "www", 2)).toBe("https://www.a.example");
    expect(at("(see www.a.example/x)", "www", 2)).toBe(
      "https://www.a.example/x",
    );
  });

  it("resolves a bare email to mailto", () => {
    expect(at("mail a@b.example now", "a@b", 1)).toBe("mailto:a@b.example");
  });

  it("resolves a www destination to https", () => {
    expect(at("[x](www.a.example/p)", "x")).toBe("https://www.a.example/p");
  });

  it("resolves an email destination to mailto", () => {
    expect(at("[x](a@b.example)", "x")).toBe("mailto:a@b.example");
  });

  it.each([
    ["file name", "see notes.md now", "notes"],
    ["version number", "v1.2.3 is out", "1.2"],
    ["domain without www", "visit a.example/p now", "a.example"],
    ["subdomain without www", "visit sub.a.example now", "sub"],
    ["at sign without domain", "ping foo@bar now", "foo@"],
  ])("returns null for a bare %s", (_, doc, needle) => {
    expect(at(doc, needle, 1)).toBeNull();
  });

  it("returns null outside any link", () => {
    expect(at("plain [x](https://a.example) text", "plain", 2)).toBeNull();
  });

  it("returns null for an empty doc", () => {
    expect(linkUrlAt(stateFor(""), 0)).toBeNull();
  });
});

describe("toOpenableUrl", () => {
  it.each([
    ["http://a.example", "http://a.example"],
    ["HTTPS://a.example", "HTTPS://a.example"],
    ["mailto:a@b.example", "mailto:a@b.example"],
    ["www.a.example", "https://www.a.example"],
    ["WWW.a.example:8080/p", "https://WWW.a.example:8080/p"],
    ["a.b+c@d.example", "mailto:a.b+c@d.example"],
    ["a@my_host.example", "mailto:a@my_host.example"],
  ])("accepts %s as %s", (text, url) => {
    expect(toOpenableUrl(text)).toBe(url);
  });

  it.each([
    "",
    "a.example",
    "notes/a.md",
    "//a.example",
    "javascript:1",
    "data:text/html,hi",
    "ftp://a.example",
    "a@b",
  ])("rejects %j", (text) => {
    expect(toOpenableUrl(text)).toBeNull();
  });
});
