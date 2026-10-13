// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { captureFocusReturn, resolveFocusTarget, returnFocus } from "./focus-return";

function render(html: string): void {
  document.body.innerHTML = html;
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    Object.defineProperty(el, "getClientRects", {
      value: () => (el.hasAttribute("data-hidden") ? [] : [{}]),
    });
  }
}

const TREE = `
  <div role="tree">
    <div role="treeitem" id="open" aria-selected="true" tabindex="-1">open</div>
    <div role="treeitem" id="roving" aria-selected="false" tabindex="0">roving</div>
  </div>`;

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(id);
  return found;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("captureFocusReturn", () => {
  it("returns the focused element and ignores body", () => {
    render(`<button id="b">b</button>`);
    expect(captureFocusReturn()).toBeNull();
    el("b").focus();
    expect(captureFocusReturn()).toBe(el("b"));
  });
});

describe("resolveFocusTarget", () => {
  it("prefers the recorded element", () => {
    render(`<button id="b">b</button>${TREE}`);
    expect(resolveFocusTarget(el("b"))).toBe(el("b"));
  });

  it("falls back to the open note row when the recorded element is disconnected", () => {
    render(`<button id="b">b</button>${TREE}`);
    const gone = el("b");
    gone.remove();
    expect(resolveFocusTarget(gone)).toBe(el("open"));
  });

  it("falls back when the recorded element is disabled", () => {
    render(`<button id="b" disabled>b</button>${TREE}`);
    expect(resolveFocusTarget(el("b"))).toBe(el("open"));
  });

  it("falls back when the recorded element is inert", () => {
    render(`<div inert><button id="b">b</button></div>${TREE}`);
    expect(resolveFocusTarget(el("b"))).toBe(el("open"));
  });

  it("falls back when the recorded element is inside a closed dialog", () => {
    render(`<dialog><button id="b">b</button></dialog>${TREE}`);
    expect(resolveFocusTarget(el("b"))).toBe(el("open"));
  });

  it("falls back when the recorded element is not rendered", () => {
    render(`<button id="b" data-hidden>b</button>${TREE}`);
    expect(resolveFocusTarget(el("b"))).toBe(el("open"));
  });

  it("falls back to the tabbable row when the open note row is unusable", () => {
    render(TREE.replace('id="open"', 'id="open" data-hidden'));
    expect(resolveFocusTarget(null)).toBe(el("roving"));
  });

  it("returns null when nothing qualifies", () => {
    render(`<button id="b" disabled>b</button>`);
    expect(resolveFocusTarget(el("b"))).toBeNull();
  });
});

describe("returnFocus", () => {
  it("focuses the target when focus is on body", () => {
    render(`<button id="b">b</button>`);
    returnFocus(el("b"), null);
    expect(document.activeElement).toBe(el("b"));
  });

  it("focuses the target when focus is inside the closing dialog", () => {
    render(`<button id="b">b</button><dialog id="d"><input id="i"></dialog>`);
    el("i").focus();
    returnFocus(el("b"), el("d"));
    expect(document.activeElement).toBe(el("b"));
  });

  it("does not override focus that is already elsewhere", () => {
    render(`<button id="b">b</button><button id="c">c</button>`);
    el("c").focus();
    returnFocus(el("b"), null);
    expect(document.activeElement).toBe(el("c"));
  });
});
