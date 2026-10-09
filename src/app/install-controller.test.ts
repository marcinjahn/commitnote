import { describe, expect, it } from "vitest";
import type { StorageLike } from "../session/session-store";
import { INSTALL_BAR_DISMISSED_KEY } from "./install-bar-dismissal";
import {
  createInstallController,
  type InstallControllerDeps,
  type InstallEnvironment,
  type InstallState,
} from "./install-controller";
import type {
  DeferredInstallPrompt,
  InstallChoice,
} from "./install-events";

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

class FakePrompt implements DeferredInstallPrompt {
  calls = 0;
  readonly userChoice: Promise<InstallChoice>;

  constructor(
    outcome: InstallChoice["outcome"] | "reject-prompt" | "reject-choice",
  ) {
    this.userChoice =
      outcome === "reject-choice"
        ? Promise.reject(new Error("choice failed"))
        : Promise.resolve({
            outcome: outcome === "reject-prompt" ? "dismissed" : outcome,
          });
    this.userChoice.catch(() => undefined);
    this.rejectPrompt = outcome === "reject-prompt";
  }

  private readonly rejectPrompt: boolean;

  prompt(): Promise<unknown> {
    this.calls++;
    return this.rejectPrompt
      ? Promise.reject(new Error("prompt failed"))
      : Promise.resolve();
  }
}

class FakeEvents {
  prompt: DeferredInstallPrompt | null = null;
  isInstalled = false;
  private readonly listeners = new Set<() => void>();

  deferredPrompt = () => this.prompt;
  installed = () => this.isInstalled;
  takePrompt = () => {
    const taken = this.prompt;
    if (!taken) return null;
    this.prompt = null;
    this.emit();
    return taken;
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  receivePrompt(prompt: DeferredInstallPrompt): void {
    this.prompt = prompt;
    this.emit();
  }

  appInstalled(): void {
    this.isInstalled = true;
    this.prompt = null;
    this.emit();
  }
}

const android: InstallEnvironment = {
  coarsePointer: true,
  browserDisplayMode: true,
  standalone: false,
  ios: false,
};

function setup(
  environment: Partial<InstallEnvironment> = {},
  options: { prompt?: DeferredInstallPrompt; storage?: StorageLike } = {},
) {
  const events = new FakeEvents();
  events.prompt = options.prompt ?? null;
  const storage = options.storage ?? new MemoryStorage();
  const deps: InstallControllerDeps = {
    environment: { ...android, ...environment },
    events,
    storage,
  };
  const controller = createInstallController(deps);
  const states: InstallState[] = [];
  controller.subscribe((state) => states.push(state));
  return { controller, events, storage, states };
}

describe("createInstallController", () => {
  it("offers the prompt on Android and drops it after appinstalled", () => {
    const { controller, events, states } = setup(
      {},
      { prompt: new FakePrompt("accepted") },
    );
    expect(controller.getState()).toEqual({
      bar: "prompt",
      command: "prompt",
      howToOpen: false,
    });

    events.appInstalled();

    expect(controller.getState()).toEqual({
      bar: "none",
      command: null,
      howToOpen: false,
    });
    expect(states).toHaveLength(1);
    expect(states[0]?.bar).toBe("none");
  });

  it("does not notify on subscribe", () => {
    const { states } = setup();
    expect(states).toEqual([]);
  });

  it("updates and notifies when a prompt arrives later", () => {
    const { controller, events, states } = setup();
    expect(controller.getState().bar).toBe("none");

    events.receivePrompt(new FakePrompt("accepted"));

    expect(controller.getState().bar).toBe("prompt");
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ bar: "prompt", command: "prompt" });
  });

  it("stops notifying after unsubscribe", () => {
    const { controller, events } = setup();
    const received: InstallState[] = [];
    const unsubscribe = controller.subscribe((state) => received.push(state));
    unsubscribe();
    events.receivePrompt(new FakePrompt("accepted"));
    expect(received).toEqual([]);
  });

  describe("install with the prompt path", () => {
    it("prompts once and leaves no dismissal when accepted", async () => {
      const prompt = new FakePrompt("accepted");
      const { controller, storage } = setup({}, { prompt });

      await controller.install();

      expect(prompt.calls).toBe(1);
      expect((storage as MemoryStorage).map.size).toBe(0);
      expect(controller.getState()).toEqual({
        bar: "none",
        command: null,
        howToOpen: false,
      });
    });

    it("stores the dismissal when the browser dialog is declined", async () => {
      const prompt = new FakePrompt("dismissed");
      const { controller, events, storage } = setup({}, { prompt });

      await controller.install();

      expect(prompt.calls).toBe(1);
      expect((storage as MemoryStorage).map.get(INSTALL_BAR_DISMISSED_KEY)).toBe(
        "1",
      );
      expect(controller.getState().bar).toBe("none");

      events.receivePrompt(new FakePrompt("accepted"));
      expect(controller.getState()).toMatchObject({
        bar: "none",
        command: "prompt",
      });
    });

    it("swallows a rejecting prompt without dismissing", async () => {
      const prompt = new FakePrompt("reject-prompt");
      const { controller, events, storage } = setup({}, { prompt });

      await expect(controller.install()).resolves.toBeUndefined();

      expect((storage as MemoryStorage).map.size).toBe(0);
      expect(events.deferredPrompt()).toBeNull();
      expect(controller.getState().command).toBeNull();
    });

    it("swallows a rejecting user choice without dismissing", async () => {
      const prompt = new FakePrompt("reject-choice");
      const { controller, storage } = setup({}, { prompt });

      await expect(controller.install()).resolves.toBeUndefined();

      expect((storage as MemoryStorage).map.size).toBe(0);
    });

    it("does nothing when there is no prompt to take", async () => {
      const { controller, states } = setup({ ios: false });
      await controller.install();
      expect(states).toEqual([]);
    });
  });

  describe("on iOS", () => {
    it("opens and closes the How-to dialog and notifies each time", async () => {
      const { controller, states } = setup({ ios: true });
      expect(controller.getState()).toMatchObject({
        bar: "ios",
        command: "ios",
        howToOpen: false,
      });

      await controller.install();
      expect(controller.getState().howToOpen).toBe(true);
      expect(states).toHaveLength(1);

      controller.closeHowTo();
      expect(controller.getState().howToOpen).toBe(false);
      expect(states).toHaveLength(2);

      controller.closeHowTo();
      expect(states).toHaveLength(2);
    });
  });

  describe("dismiss", () => {
    it("stores the flag, hides the bar and keeps the command", () => {
      const { controller, storage, states } = setup(
        {},
        { prompt: new FakePrompt("accepted") },
      );

      controller.dismiss();

      expect((storage as MemoryStorage).map.get(INSTALL_BAR_DISMISSED_KEY)).toBe(
        "1",
      );
      expect(controller.getState()).toMatchObject({
        bar: "none",
        command: "prompt",
      });
      expect(states).toHaveLength(1);
    });

    it("is idempotent", () => {
      const { controller, states } = setup();
      controller.dismiss();
      controller.dismiss();
      expect(states).toHaveLength(1);
    });
  });

  it("starts hidden when the dismissal is already stored", () => {
    const storage = new MemoryStorage();
    storage.setItem(INSTALL_BAR_DISMISSED_KEY, "1");
    const { controller } = setup(
      {},
      { prompt: new FakePrompt("accepted"), storage },
    );
    expect(controller.getState()).toMatchObject({
      bar: "none",
      command: "prompt",
    });
  });

  it("keeps the command but no bar on a desktop with a fine pointer", () => {
    const { controller } = setup(
      { coarsePointer: false },
      { prompt: new FakePrompt("accepted") },
    );
    expect(controller.getState()).toEqual({
      bar: "none",
      command: "prompt",
      howToOpen: false,
    });
  });

  it("offers nothing when standalone, even with a prompt", () => {
    const { controller } = setup(
      { standalone: true },
      { prompt: new FakePrompt("accepted") },
    );
    expect(controller.getState()).toEqual({
      bar: "none",
      command: null,
      howToOpen: false,
    });
  });
});
