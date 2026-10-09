import { describe, expect, it } from "vitest";
import { bindDialogHistory } from "./dialog-history";
import { createDialogStack } from "./dialog-stack";

function setup(options: { refusing?: readonly string[] } = {}) {
  const stack = createDialogStack<string>();
  const calls: ("push" | "consume")[] = [];
  const requested: string[] = [];
  const refusing = new Set(options.refusing ?? []);
  const pendingCloses: string[] = [];
  const navigation = {
    pushDialog: () => calls.push("push"),
    consumeDialog: () => calls.push("consume"),
  };
  const bind = () =>
    bindDialogHistory({
      stack,
      navigation,
      requestClose: (item) => {
        requested.push(item);
        if (!refusing.has(item)) pendingCloses.push(item);
      },
      settle: async () => {
        for (const item of pendingCloses.splice(0)) stack.unregister(item);
      },
    });
  return { stack, calls, requested, bind };
}

describe("bindDialogHistory", () => {
  it("pushes an entry when a dialog opens", () => {
    const { stack, calls, bind } = setup();
    bind();

    stack.register("settings");

    expect(calls).toEqual(["push"]);
  });

  it("pushes an entry for each nested dialog", () => {
    const { stack, calls, bind } = setup();
    bind();

    stack.register("settings");
    stack.register("passphrase");

    expect(calls).toEqual(["push", "push"]);
  });

  it("consumes an entry when the top dialog closes from the UI", () => {
    const { stack, calls, bind } = setup();
    bind();
    stack.register("settings");

    stack.unregister("settings");

    expect(calls).toEqual(["push", "consume"]);
  });

  it("consumes one entry per dialog when a parent and child close together", () => {
    const { stack, calls, bind } = setup();
    bind();
    stack.register("settings");
    stack.register("passphrase");

    stack.unregister("passphrase");
    stack.unregister("settings");

    expect(calls).toEqual(["push", "push", "consume", "consume"]);
  });

  it("consumes an entry when a dialog closes underneath another", () => {
    const { stack, calls, bind } = setup();
    bind();
    stack.register("trash");
    stack.register("confirm");

    stack.unregister("trash");

    expect(calls).toEqual(["push", "push", "consume"]);
  });

  it("closes only the top dialog on a single Back without consuming", async () => {
    const { stack, calls, requested, bind } = setup();
    const history = bind();
    stack.register("settings");
    stack.register("passphrase");

    await history.closeFromBack(1);

    expect(requested).toEqual(["passphrase"]);
    expect(stack.top()).toBe("settings");
    expect(calls).toEqual(["push", "push"]);
  });

  it("closes the topmost dialogs first when Back passed several entries", async () => {
    const { stack, calls, requested, bind } = setup();
    const history = bind();
    stack.register("settings");
    stack.register("passphrase");

    await history.closeFromBack(2);

    expect(requested).toEqual(["passphrase", "settings"]);
    expect(stack.top()).toBeNull();
    expect(calls).toEqual(["push", "push"]);
  });

  it("pushes the entry again for a dialog that refuses to close", async () => {
    const { stack, calls, requested, bind } = setup({ refusing: ["logout"] });
    const history = bind();
    stack.register("logout");

    await history.closeFromBack(1);

    expect(requested).toEqual(["logout"]);
    expect(stack.top()).toBe("logout");
    expect(calls).toEqual(["push", "push"]);
  });

  it("consumes the entry of a refusing dialog that later closes from the UI", async () => {
    const { stack, calls, bind } = setup({ refusing: ["logout"] });
    const history = bind();
    stack.register("logout");
    await history.closeFromBack(1);

    stack.unregister("logout");

    expect(calls).toEqual(["push", "push", "consume"]);
  });

  it("pushes entries for dialogs already open when bound", () => {
    const { stack, calls, bind } = setup();
    stack.register("settings");
    stack.register("passphrase");

    bind();

    expect(calls).toEqual(["push", "push"]);
  });

  it("stops tracking dialogs after dispose", () => {
    const { stack, calls, bind } = setup();
    const history = bind();
    stack.register("settings");

    history.dispose();
    stack.unregister("settings");
    stack.register("trash");

    expect(calls).toEqual(["push"]);
  });
});
