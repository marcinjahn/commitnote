import { describe, expect, it } from "vitest";
import { compareKeys } from "./fractional-key";
import { placementPositions } from "./placement";

function visibleOrder(
  existing: ReadonlyMap<string, string>,
  positions: readonly { name: string; key: string }[],
  names: readonly string[],
): string[] {
  const keys = new Map(existing);
  for (const { name, key } of positions) keys.set(name, key);
  const keyed = names
    .filter((name) => keys.has(name))
    .sort((a, b) => compareKeys(keys.get(a)!, keys.get(b)!));
  return [...keyed, ...names.filter((name) => !keys.has(name))];
}

describe("placementPositions", () => {
  it("positions only the moved item between two positioned siblings", () => {
    const order = new Map([
      ["A", "F"],
      ["B", "V"],
    ]);
    const positions = placementPositions(order, ["A", "B"], "X", 1);

    expect(positions.map(({ name }) => name)).toEqual(["X"]);
    expect(visibleOrder(order, positions, ["A", "B", "X"])).toEqual(["A", "X", "B"]);
  });

  it("also positions unpositioned siblings, keeping their visible order", () => {
    const order = new Map([["A", "V"]]);
    const positions = placementPositions(order, ["A", "C", "D"], "X", 2);

    expect(positions.map(({ name }) => name)).toEqual(["C", "X", "D"]);
    expect(visibleOrder(order, positions, ["A", "C", "D", "X"])).toEqual([
      "A",
      "C",
      "X",
      "D",
    ]);
  });

  it("positions every sibling afresh when neighbouring positions are equal", () => {
    const order = new Map([
      ["A", "V"],
      ["B", "V"],
    ]);
    const positions = placementPositions(order, ["A", "B"], "X", 1);

    expect(positions.map(({ name }) => name)).toEqual(["A", "X", "B"]);
    expect(visibleOrder(order, positions, ["A", "B", "X"])).toEqual(["A", "X", "B"]);
  });
});
