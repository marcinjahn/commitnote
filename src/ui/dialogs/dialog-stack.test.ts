import { describe, expect, it } from "vitest";
import { createDialogStack } from "./dialog-stack";

describe("createDialogStack", () => {
  it("is empty at first", () => {
    expect(createDialogStack<string>().top()).toBeNull();
  });

  it("keeps the most recently registered item on top", () => {
    const stack = createDialogStack<string>();
    stack.register("a");
    stack.register("b");
    stack.register("c");

    expect(stack.top()).toBe("c");
  });

  it("moves an item registered again to the top", () => {
    const stack = createDialogStack<string>();
    stack.register("a");
    stack.register("b");
    stack.register("a");

    expect(stack.top()).toBe("a");
    stack.unregister("a");
    expect(stack.top()).toBe("b");
  });

  it("keeps the top when a middle item is unregistered", () => {
    const stack = createDialogStack<string>();
    stack.register("a");
    stack.register("b");
    stack.register("c");

    stack.unregister("b");

    expect(stack.top()).toBe("c");
    stack.unregister("c");
    expect(stack.top()).toBe("a");
  });

  it("falls back to the previous item when the top is unregistered", () => {
    const stack = createDialogStack<string>();
    stack.register("a");
    stack.register("b");

    stack.unregister("b");

    expect(stack.top()).toBe("a");
  });

  it("ignores unregistering an item that is not registered", () => {
    const stack = createDialogStack<string>();
    stack.register("a");

    stack.unregister("b");
    stack.unregister("a");
    stack.unregister("a");

    expect(stack.top()).toBeNull();
  });

  it("notifies a subscriber at once and then only when the top changes", () => {
    const stack = createDialogStack<string>();
    stack.register("a");
    const seen: (string | null)[] = [];

    stack.subscribe((top) => seen.push(top));
    stack.register("b");
    stack.register("c");
    stack.unregister("b");
    stack.unregister("b");
    stack.unregister("c");
    stack.unregister("a");

    expect(seen).toEqual(["a", "b", "c", "a", null]);
  });

  it("stops notifying after unsubscribe", () => {
    const stack = createDialogStack<string>();
    const seen: (string | null)[] = [];

    const unsubscribe = stack.subscribe((top) => seen.push(top));
    stack.register("a");
    unsubscribe();
    stack.register("b");

    expect(seen).toEqual([null, "a"]);
  });
});
