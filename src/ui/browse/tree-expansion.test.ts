import { describe, expect, it } from "vitest";
import { createTreeExpansion } from "./tree-expansion.svelte";

describe("createTreeExpansion", () => {
  it("starts empty", () => {
    const expansion = createTreeExpansion();
    expect(expansion.expandedPaths()).toEqual([]);
    expect(expansion.isExpanded(["a"])).toBe(false);
  });

  it("seeds from the initial paths", () => {
    const expansion = createTreeExpansion([["a"], ["a", "b"]]);
    expect(expansion.isExpanded(["a", "b"])).toBe(true);
    expect(expansion.expandedPaths()).toEqual([["a"], ["a", "b"]]);
  });

  it("expands and collapses", () => {
    const expansion = createTreeExpansion();
    expansion.setExpanded(["a"], true);
    expect(expansion.isExpanded(["a"])).toBe(true);
    expansion.setExpanded(["a"], false);
    expect(expansion.isExpanded(["a"])).toBe(false);
    expect(expansion.expandedPaths()).toEqual([]);
  });

  it("maps equal but distinct arrays to one entry", () => {
    const expansion = createTreeExpansion();
    expansion.setExpanded(["a", "b"], true);
    expansion.setExpanded(["a", "b"], true);
    expect(expansion.expandedPaths()).toEqual([["a", "b"]]);
    expansion.setExpanded(["a", "b"], false);
    expect(expansion.expandedPaths()).toEqual([]);
  });

  it("keeps insertion order", () => {
    const expansion = createTreeExpansion();
    expansion.setExpanded(["z"], true);
    expansion.setExpanded(["a"], true);
    expansion.setExpanded(["m"], true);
    expect(expansion.expandedPaths()).toEqual([["z"], ["a"], ["m"]]);
  });

  it("returns fresh copies", () => {
    const expansion = createTreeExpansion([["a", "b"]]);
    const first = expansion.expandedPaths();
    (first[0] as string[]).push("x");
    first.push(["y"]);
    expect(expansion.expandedPaths()).toEqual([["a", "b"]]);
  });

  it("does not alias the paths it was given", () => {
    const path = ["a"];
    const expansion = createTreeExpansion([path]);
    path.push("b");
    expect(expansion.isExpanded(["a"])).toBe(true);
  });

  it("keeps paths that collide under join distinct", () => {
    const expansion = createTreeExpansion();
    expansion.setExpanded(["a/b"], true);
    expect(expansion.isExpanded(["a", "b"])).toBe(false);
    expansion.setExpanded(["a", "b"], true);
    expect(expansion.expandedPaths()).toEqual([["a/b"], ["a", "b"]]);
  });
});
