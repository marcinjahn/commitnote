import { afterEach, describe, expect, it, vi } from "vitest";
import { noteFragmentOf } from "./note-fragment";
import { createBrowserPlatformPorts } from "./platform-ports";

class FakeTarget {
  private readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

interface Env {
  win: FakeTarget & { history: { replaceState: ReturnType<typeof vi.fn> } };
  doc: FakeTarget & { visibilityState: string };
  nav: { onLine: boolean; storage?: unknown };
  loc: { origin: string; pathname: string; search: string; hash: string };
}

function stubBrowser(overrides: Partial<Env["nav"]> = {}): Env {
  const win = Object.assign(new FakeTarget(), {
    history: { replaceState: vi.fn() },
  });
  const doc = Object.assign(new FakeTarget(), { visibilityState: "visible" });
  const nav = { onLine: true, ...overrides };
  const loc = { origin: "https://app.test", pathname: "/app/", search: "", hash: "" };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("location", loc);
  (win as unknown as { location: unknown }).location = loc;
  return { win, doc, nav, loc };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser platform ports", () => {
  it("reads connectivity and notifies on online and offline events", () => {
    const env = stubBrowser();
    const { connectivity } = createBrowserPlatformPorts();
    const seen: boolean[] = [];
    const unsubscribe = connectivity.subscribe((online) => seen.push(online));

    expect(connectivity.isOnline()).toBe(true);
    env.nav.onLine = false;
    expect(connectivity.isOnline()).toBe(false);

    env.win.emit("offline");
    env.win.emit("online");
    expect(seen).toEqual([false, true]);

    unsubscribe();
    env.win.emit("offline");
    expect(seen).toEqual([false, true]);
    expect(env.win.count("online") + env.win.count("offline")).toBe(0);
  });

  it("reads visibility and notifies on visibilitychange", () => {
    const env = stubBrowser();
    const { visibility } = createBrowserPlatformPorts();
    const seen: boolean[] = [];
    const unsubscribe = visibility.subscribe((visible) => seen.push(visible));

    expect(visibility.isVisible()).toBe(true);
    env.doc.visibilityState = "hidden";
    expect(visibility.isVisible()).toBe(false);
    env.doc.emit("visibilitychange");
    env.doc.visibilityState = "visible";
    env.doc.emit("visibilitychange");
    expect(seen).toEqual([false, true]);

    unsubscribe();
    env.doc.emit("visibilitychange");
    expect(seen).toEqual([false, true]);
    expect(env.doc.count("visibilitychange")).toBe(0);
  });

  it("requests persistent storage through navigator.storage", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubBrowser({ storage: { persist, persisted: vi.fn().mockResolvedValue(false) } });
    await createBrowserPlatformPorts().persistentStorage?.request();
    expect(persist).toHaveBeenCalledOnce();
  });

  it("tolerates a missing navigator.storage", async () => {
    stubBrowser();
    await expect(createBrowserPlatformPorts().persistentStorage?.request()).resolves.toBeUndefined();
  });

  it("builds the share link base from the location", () => {
    stubBrowser();
    expect(createBrowserPlatformPorts().navigation.shareLinkBase()).toBe("https://app.test/app/");
  });

  it("clears a note fragment from the history entry", () => {
    const env = stubBrowser();
    const { navigation } = createBrowserPlatformPorts();

    navigation.clearNoteFragment();
    expect(env.win.history.replaceState).not.toHaveBeenCalled();

    env.loc.hash = noteFragmentOf("abc");
    navigation.clearNoteFragment();
    expect(env.win.history.replaceState).toHaveBeenCalledOnce();
  });
});
