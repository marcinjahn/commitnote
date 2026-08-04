// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render-markdown";

const WELCOME_MARKDOWN = [
  "# Welcome",
  "",
  "This is your **notes** repo, encrypted end to end. Some *emphasis*, ~~strikethrough~~, and `inline code`.",
  "",
  "```js",
  'console.log("hello");',
  "```",
  "",
  "See the [git-notes project](https://github.com/example/git-notes) for details.",
  "",
  "> Notes stay private even to the forge that hosts them.",
  "",
  "- First bullet",
  "- Second bullet",
  "",
  "1. First step",
  "2. Second step",
  "",
  "- [x] Done task",
  "- [ ] Open task",
  "",
  "| Column A | Column B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
].join("\n");

function parse(html: string): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("renderMarkdown", () => {
  it("renders a GFM table with header and body cells", () => {
    const container = parse(
      renderMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |\n"),
    );
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll("th").length).toBe(2);
    expect(table?.querySelectorAll("td").length).toBe(2);
  });

  it("renders strikethrough text", () => {
    const container = parse(renderMarkdown("~~x~~"));
    const struck = container.querySelector("s, del");
    expect(struck).not.toBeNull();
    expect(struck?.textContent).toBe("x");
  });

  it("renders a checked, disabled checkbox for a done task", () => {
    const container = parse(renderMarkdown("- [x] Done\n"));
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(true);
    expect(checkbox?.disabled).toBe(true);
  });

  it("renders an unchecked, disabled checkbox for an open task", () => {
    const container = parse(renderMarkdown("- [ ] Open\n"));
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(false);
    expect(checkbox?.disabled).toBe(true);
  });

  it("linkifies a bare URL", () => {
    const container = parse(renderMarkdown("https://example.com"));
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
  });

  it("adds target and rel to links", () => {
    const container = parse(renderMarkdown("[a](https://example.com)"));
    const link = container.querySelector("a");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("strips javascript: hrefs", () => {
    const container = parse(renderMarkdown("[a](javascript:alert(1))"));
    const links = Array.from(container.querySelectorAll("a"));
    for (const link of links) {
      expect(link.getAttribute("href")).not.toMatch(/^javascript:/i);
    }
  });

  it("neutralizes raw script tags and event handler attributes", () => {
    const container = parse(
      renderMarkdown(
        "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>",
      ),
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
  });

  it("keeps an https image src", () => {
    const container = parse(renderMarkdown("![a](https://example.com/a.png)"));
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/a.png",
    );
  });

  it("keeps a data image src", () => {
    const container = parse(
      renderMarkdown("![a](data:image/png;base64,iVBORw0KGgo=)"),
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });

  it("drops an http image src", () => {
    const container = parse(renderMarkdown("![a](http://example.com/a.png)"));
    expect(container.querySelector("img")?.hasAttribute("src")).toBe(false);
  });

  it("drops a relative image src", () => {
    const container = parse(renderMarkdown("![a](a.png)"));
    expect(container.querySelector("img")?.hasAttribute("src")).toBe(false);
  });

  it("renders every feature exercised by the welcome note", () => {
    const container = parse(renderMarkdown(WELCOME_MARKDOWN));
    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector("pre code")).not.toBeNull();
    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
  });
});
