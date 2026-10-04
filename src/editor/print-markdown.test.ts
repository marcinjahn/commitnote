// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderPrintMarkdown } from "./print-markdown";

function render(md: string): HTMLDivElement {
  const el = document.createElement("div");
  el.append(renderPrintMarkdown(md));
  return el;
}

function one(el: Element, selector: string): Element {
  const found = el.querySelector(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

function brCount(el: Element): number {
  return el.querySelectorAll("br").length;
}

describe("renderPrintMarkdown headings", () => {
  it.each([1, 2, 3, 4, 5, 6])("renders ATX level %i without marks", (level) => {
    const el = render(`${"#".repeat(level)} Title  ${"#".repeat(level)}\n`);
    expect(el.children).toHaveLength(1);
    expect(el.children[0].tagName).toBe(`H${level}`);
    expect(el.children[0].textContent).toBe("Title");
  });

  it("renders an ATX heading without closing marks", () => {
    const el = render("## Plain *title*\n\nbody\n");
    expect(one(el, "h2").textContent).toBe("Plain title");
    expect(one(el, "h2 > em").textContent).toBe("title");
  });

  it("renders Setext level 1 as h1", () => {
    const el = render("Title\n=====\n");
    expect(one(el, "h1").textContent).toBe("Title");
    expect(el.textContent).not.toContain("=");
  });

  it("renders Setext level 2 as h2", () => {
    const el = render("Title\n-----\n");
    expect(one(el, "h2").textContent).toBe("Title");
    expect(el.textContent).not.toContain("-");
  });
});

describe("renderPrintMarkdown inline formatting", () => {
  it("renders emphasis, strong and strikethrough without marks", () => {
    const el = render("*a* **b** ~~c~~ **x *y***\n");
    expect(one(el, "p > em").textContent).toBe("a");
    expect(one(el, "p > strong").textContent).toBe("b");
    expect(one(el, "p > s").textContent).toBe("c");
    expect(one(el, "strong > em").textContent).toBe("y");
    expect(el.textContent).toBe("a b c x y");
  });

  it("renders inline code without code marks", () => {
    const el = render("use `a *b*` here\n");
    expect(one(el, "p > code").textContent).toBe("a *b*");
    expect(el.textContent).toBe("use a *b* here");
  });

  it("prints an escaped character without the backslash", () => {
    expect(render("\\*not em\\*\n").textContent).toBe("*not em*");
  });

  it("keeps entity source text", () => {
    expect(render("a &amp; b &copy;\n").textContent).toBe("a &amp; b &copy;");
  });
});

describe("renderPrintMarkdown line breaks", () => {
  it("keeps soft line breaks as br", () => {
    const p = one(render("one\ntwo\nthree\n"), "p");
    expect(brCount(p)).toBe(2);
    expect(p.textContent).toBe("onetwothree");
  });

  it("renders a hard break as a single br without its marker", () => {
    const backslash = one(render("one\\\ntwo\n"), "p");
    expect(brCount(backslash)).toBe(1);
    expect(backslash.textContent).toBe("onetwo");
    const spaces = one(render("one  \ntwo\n"), "p");
    expect(brCount(spaces)).toBe(1);
    expect(spaces.textContent).toBe("onetwo");
  });

  it("keeps soft breaks in a quoted paragraph without quote marks", () => {
    const p = one(render("> one\n> two\n"), "blockquote > p");
    expect(brCount(p)).toBe(1);
    expect(p.textContent).toBe("onetwo");
  });

  it("keeps soft breaks in a list item paragraph without indentation", () => {
    const p = one(render("- one\n  two\n"), "li > p");
    expect(brCount(p)).toBe(1);
    expect(p.textContent).toBe("onetwo");
  });
});

describe("renderPrintMarkdown lists", () => {
  it("renders nested bullet and ordered lists", () => {
    const el = render("- a\n  1. b\n  2. c\n- d\n");
    const items = el.querySelectorAll("ul > li");
    expect(items).toHaveLength(2);
    expect(one(items[0], "p").textContent).toBe("a");
    const nested = one(items[0], "ol");
    expect(
      Array.from(nested.querySelectorAll("li")).map((li) => li.textContent),
    ).toEqual(["b", "c"]);
    expect(nested.hasAttribute("start")).toBe(false);
    expect(items[1].textContent).toBe("d");
  });

  it("sets start on an ordered list not starting at 1", () => {
    expect(one(render("3. a\n4. b\n"), "ol").getAttribute("start")).toBe("3");
  });

  it("renders task items with state, box and no marker", () => {
    const el = render("- [x] done\n- [X] also\n- [ ] open\n");
    const items = Array.from(el.querySelectorAll("li"));
    expect(items.map((li) => li.getAttribute("data-task"))).toEqual([
      "done",
      "done",
      "open",
    ]);
    const box = items[2].firstChild as Element;
    expect(box.nodeName).toBe("SPAN");
    expect(box.className).toBe("print-task-box");
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.childNodes).toHaveLength(0);
    expect(items.map((li) => li.textContent)).toEqual(["done", "also", "open"]);
  });
});

describe("renderPrintMarkdown blocks", () => {
  it("renders nested blockquotes", () => {
    const el = render("> outer\n>\n> > inner\n");
    expect(one(el, "blockquote > p").textContent).toBe("outer");
    expect(one(el, "blockquote > blockquote > p").textContent).toBe("inner");
    expect(el.textContent).not.toContain(">");
  });

  it("renders fenced code without fences and info string", () => {
    const el = render("```js\nconst a = 1;\n  b();\n```\n");
    expect(one(el, "pre > code").textContent).toBe("const a = 1;\n  b();");
  });

  it("strips list indentation from fenced code in a list item", () => {
    const el = render("- item\n\n  ```js\n  a\n    b\n  ```\n");
    expect(one(el, "li > pre > code").textContent).toBe("a\n  b");
  });

  it("strips quote marks from fenced code in a blockquote", () => {
    const el = render("> ```\n> x\n>   y\n> ```\n");
    expect(one(el, "blockquote > pre > code").textContent).toBe("x\n  y");
  });

  it("renders indented code without its indentation", () => {
    const el = render("para\n\n    code1\n      code2\n    code3\n");
    expect(one(el, "pre > code").textContent).toBe("code1\n  code2\ncode3");
  });

  it("renders a horizontal rule", () => {
    const el = render("a\n\n---\n\nb\n");
    expect(Array.from(el.children).map((c) => c.tagName)).toEqual([
      "P",
      "HR",
      "P",
    ]);
  });

  it("renders a table with alignment and empty cells in their columns", () => {
    const el = render(
      "| L | C | R | N |\n|:--|:-:|--:|---|\n| a | | c | d |\n| x |\n",
    );
    const headers = Array.from(el.querySelectorAll("thead > tr > th"));
    expect(headers.map((th) => th.textContent)).toEqual(["L", "C", "R", "N"]);
    expect(headers.map((th) => (th as HTMLElement).style.textAlign)).toEqual([
      "left",
      "center",
      "right",
      "",
    ]);
    const rows = el.querySelectorAll("tbody > tr");
    expect(Array.from(rows[0].children).map((td) => td.textContent)).toEqual([
      "a",
      "",
      "c",
      "d",
    ]);
    expect((rows[0].children[2] as HTMLElement).style.textAlign).toBe("right");
    expect(Array.from(rows[1].children).map((td) => td.textContent)).toEqual([
      "x",
      "",
      "",
      "",
    ]);
  });

  it("omits tbody for a table without body rows", () => {
    const el = render("| a | b |\n|---|---|\n");
    expect(el.querySelector("thead")).not.toBeNull();
    expect(el.querySelector("tbody")).toBeNull();
  });
});

describe("renderPrintMarkdown links", () => {
  it("renders a link with href and url suffix", () => {
    const el = render('see [site](https://example.com/a "Title") end\n');
    const a = one(el, "p > a");
    expect(a.getAttribute("href")).toBe("https://example.com/a");
    expect(a.textContent).toBe("site");
    const suffix = a.nextSibling as Element;
    expect(suffix.className).toBe("print-url");
    expect(suffix.textContent).toBe(" (https://example.com/a)");
    expect(el.textContent).toBe("see site (https://example.com/a) end");
  });

  it("omits the suffix when the link text equals its url", () => {
    const el = render("[https://example.com](https://example.com)\n");
    expect(one(el, "a").getAttribute("href")).toBe("https://example.com");
    expect(el.querySelector(".print-url")).toBeNull();
    expect(el.textContent).toBe("https://example.com");
  });

  it("renders autolink, bare url and www url without suffix", () => {
    const el = render(
      "<https://a.example> and https://b.example and www.c.example\n",
    );
    const anchors = Array.from(el.querySelectorAll("a"));
    expect(anchors.map((a) => a.getAttribute("href"))).toEqual([
      "https://a.example",
      "https://b.example",
      "https://www.c.example",
    ]);
    expect(anchors.map((a) => a.textContent)).toEqual([
      "https://a.example",
      "https://b.example",
      "www.c.example",
    ]);
    expect(el.querySelector(".print-url")).toBeNull();
    expect(el.textContent).toBe(
      "https://a.example and https://b.example and www.c.example",
    );
  });

  it("resolves reference links through definitions that are not printed", () => {
    const el = render(
      "[Site] and [text][Ref  One] and [missing]\n\n[site]: https://s.example\n[ref one]: <https://r.example>\n",
    );
    const anchors = Array.from(el.querySelectorAll("a"));
    expect(anchors.map((a) => a.getAttribute("href"))).toEqual([
      "https://s.example",
      "https://r.example",
    ]);
    expect(el.children).toHaveLength(1);
    expect(el.textContent).toBe(
      "Site (https://s.example) and text (https://r.example) and missing",
    );
  });

  it("renders a javascript link as plain text", () => {
    const el = render("[bad](javascript:alert(1)) end\n");
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toBe("bad end");
  });

  it("renders an image as text with its url and no img", () => {
    const el = render("![a *cat*](https://img.example/c.png)\n");
    expect(el.querySelector("img")).toBeNull();
    const image = one(el, "span.print-image");
    expect(image.textContent).toBe("a cat");
    expect((image.nextSibling as Element).className).toBe("print-url");
    expect(el.textContent).toBe("a cat (https://img.example/c.png)");
  });
});

describe("renderPrintMarkdown raw HTML", () => {
  it("prints HTML blocks and inline HTML as literal text", () => {
    const el = render(
      "<script>alert(1)</script>\n\ntext <img src=x onerror=alert(1)> <b>bold</b>\n\n<div>\nblock\n</div>\n",
    );
    expect(el.querySelector("img, script, b, div")).toBeNull();
    const paragraphs = Array.from(el.querySelectorAll("p"));
    expect(paragraphs.map((p) => p.textContent)).toEqual([
      "<script>alert(1)</script>",
      "text <img src=x onerror=alert(1)> <b>bold</b>",
      "<div>block</div>",
    ]);
    expect(brCount(paragraphs[2])).toBe(2);
  });
});

describe("renderPrintMarkdown input handling", () => {
  it.each(["", "  \n\t\n "])("returns an empty fragment for %j", (md) => {
    expect(renderPrintMarkdown(md).childNodes).toHaveLength(0);
  });

  it("renders every line of a long note", () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`);
    const text = render(lines.join("\n\n")).textContent;
    expect(text).toContain("line 1line 2");
    expect(text).toContain("line 3000");
  });

  it("creates nodes in the given document", () => {
    const doc = document.implementation.createHTMLDocument("");
    const fragment = renderPrintMarkdown("# a\n\ntext\n", doc);
    expect(fragment.ownerDocument).toBe(doc);
    expect(fragment.firstChild?.ownerDocument).toBe(doc);
  });
});
