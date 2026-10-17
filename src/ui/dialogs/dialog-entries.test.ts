import { describe, expect, it } from "vitest";
import { bindDialogHistory } from "./dialog-history";
import { createDialogEntries } from "./dialog-entries";
import { createDialogStack } from "./dialog-stack";

class FakeHistory {
  entries: unknown[] = [{ app: "base" }];
  index = 0;
  backCalls = 0;
  replaced: unknown[] = [];
  private listeners = new Set<(event: Event) => void>();

  get state(): unknown {
    return this.entries[this.index];
  }

  pushState(state: unknown): void {
    this.entries = [...this.entries.slice(0, this.index + 1), state];
    this.index += 1;
  }

  replaceState(state: unknown): void {
    this.replaced.push(state);
    this.entries[this.index] = state;
  }

  back(): void {
    this.backCalls += 1;
    this.go(-1);
  }

  go(delta: number): void {
    const target = this.index + delta;
    if (target < 0 || target >= this.entries.length) return;
    this.index = target;
    const state = this.entries[target];
    queueMicrotask(() => {
      const event = { type: "popstate", state } as unknown as Event;
      for (const listener of [...this.listeners]) listener(event);
    });
  }

  addEventListener(_type: string, listener: (event: Event) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: Event) => void): void {
    this.listeners.delete(listener);
  }
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function setup() {
  const history = new FakeHistory();
  const backs: number[] = [];
  const entries = createDialogEntries({
    history: history as unknown as History,
    events: history,
    onBack: (count) => backs.push(count),
  });
  return { history, backs, entries };
}

describe("createDialogEntries", () => {
  it("reports a user Back over a pushed dialog entry", async () => {
    const { history, backs, entries } = setup();
    entries.pushDialog();

    history.go(-1);
    await flush();

    expect(backs).toEqual([1]);
    expect(history.state).toEqual({ app: "base" });
  });

  it("reports each nested dialog separately on successive Backs", async () => {
    const { history, backs, entries } = setup();
    entries.pushDialog();
    entries.pushDialog();

    history.go(-1);
    await flush();
    history.go(-1);
    await flush();

    expect(backs).toEqual([1, 1]);
  });

  it("reports several dialogs when Back jumps over many entries", async () => {
    const { history, backs, entries } = setup();
    entries.pushDialog();
    entries.pushDialog();

    history.go(-2);
    await flush();

    expect(backs).toEqual([2]);
  });

  it("goes back once and swallows its own popstate when a dialog is consumed", async () => {
    const { history, backs, entries } = setup();
    entries.pushDialog();

    entries.consumeDialog();
    await flush();

    expect(history.backCalls).toBe(1);
    expect(backs).toEqual([]);
  });

  it("stamps a stale entry reached by Forward and ignores the next Back", async () => {
    const { history, backs, entries } = setup();
    entries.pushDialog();
    entries.consumeDialog();
    await flush();

    history.go(1);
    await flush();

    expect(history.replaced).toEqual([{ app: "base", dialogDepth: 0 }]);
    expect(backs).toEqual([]);

    history.go(-1);
    await flush();

    expect(backs).toEqual([]);
  });

  it("does nothing when consuming with nothing written", async () => {
    const { history, backs, entries } = setup();

    entries.consumeDialog();
    await flush();

    expect(history.backCalls).toBe(0);
    expect(backs).toEqual([]);
  });

  it("keeps existing keys of the base state on pushed entries", () => {
    const { history, entries } = setup();

    entries.pushDialog();

    expect(history.state).toEqual({ app: "base", dialogDepth: 1 });
  });

  it("ignores popstate after dispose", async () => {
    const { history, backs, entries } = setup();
    entries.pushDialog();
    entries.dispose();

    history.go(-1);
    await flush();

    expect(backs).toEqual([]);
  });

  it("closes the dialog on user Back through bindDialogHistory", async () => {
    const history = new FakeHistory();
    const stack = createDialogStack<string>();
    const requested: string[] = [];
    const entries = createDialogEntries({
      history: history as unknown as History,
      events: history,
      onBack: (count) => void binding.closeFromBack(count),
    });
    const binding = bindDialogHistory({
      stack,
      navigation: entries,
      requestClose: (item) => {
        requested.push(item);
        stack.unregister(item);
      },
      settle: flush,
    });

    stack.register("howto");

    expect(history.entries).toHaveLength(2);

    history.go(-1);
    await flush();
    await flush();

    expect(requested).toEqual(["howto"]);
    expect(history.backCalls).toBe(0);
  });
});
