import { beforeEach, describe, expect, it } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { testKeyring } from "../crypto/testing/test-keyring";
import type { StorageLike } from "../session/session-store";
import {
  createLastViewStore,
  LAST_VIEW_SAVE_DELAY_MS,
  lastViewStorageKey,
  removeLastView,
  type LastView,
} from "./last-view";

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  writes = 0;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes++;
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }
}

class FakeTimers {
  private next = 1;
  private readonly pending = new Map<number, () => void>();

  readonly setTimer = (run: () => void): unknown => {
    const id = this.next++;
    this.pending.set(id, run);
    return id;
  };

  readonly clearTimer = (handle: unknown): void => {
    this.pending.delete(handle as number);
  };

  get count(): number {
    return this.pending.size;
  }

  fire(): void {
    const runs = [...this.pending.values()];
    this.pending.clear();
    for (const run of runs) run();
  }
}

const REPO = "github:sample/search";
const POLISH = "Zażółć gęślą jaźń";

const view: LastView = {
  note: ["Projects", "Alpha", POLISH],
  folders: [["Projects"], ["Projects", "Alpha"]],
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

let keyring: Keyring;
let otherKeyring: Keyring;

beforeEach(async () => {
  keyring = await testKeyring();
  otherKeyring = await testKeyring("another passphrase", 9);
});

function setup(
  overrides: {
    storage?: StorageLike | null;
    repoKey?: string;
    keyring?: Keyring;
  } = {},
) {
  const storage = new MemoryStorage();
  const timers = new FakeTimers();
  const store = createLastViewStore({
    repoKey: overrides.repoKey ?? REPO,
    keyring: overrides.keyring ?? keyring,
    storage: overrides.storage === undefined ? storage : overrides.storage,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { storage, timers, store };
}

describe("last view store", () => {
  it("builds the storage key from the repo key", () => {
    expect(lastViewStorageKey(REPO)).toBe(
      "commitnote.lastView.github:sample/search",
    );
  });

  it("is off by default and on after setEnabled(true)", () => {
    const { store } = setup();
    expect(store.isEnabled()).toBe(false);
    store.setEnabled(true, { note: null, folders: [] });
    expect(store.isEnabled()).toBe(true);
  });

  it("writes the entry immediately when turned on", async () => {
    const { store, storage } = setup();
    store.setEnabled(true, view);
    const immediate = JSON.parse(storage.getItem(lastViewStorageKey(REPO))!);
    expect(immediate).toEqual({
      version: 1,
      reopenLastView: true,
      note: null,
      folders: [],
    });
    await flush();
    const settled = JSON.parse(storage.getItem(lastViewStorageKey(REPO))!);
    expect(settled.note).toEqual(expect.any(String));
    expect(settled.folders).toHaveLength(2);
    expect(await store.load()).toEqual(view);
  });

  it("removes the entry and drops a pending save when turned off", async () => {
    const { store, storage, timers } = setup();
    store.setEnabled(true, { note: null, folders: [] });
    store.save(view);
    store.setEnabled(false, view);
    expect(storage.getItem(lastViewStorageKey(REPO))).toBeNull();
    expect(store.isEnabled()).toBe(false);
    expect(timers.count).toBe(0);
    timers.fire();
    await flush();
    expect(storage.getItem(lastViewStorageKey(REPO))).toBeNull();
  });

  it("drops an in-flight encode when turned off", async () => {
    const { store, storage } = setup();
    store.setEnabled(true, view);
    store.setEnabled(false, view);
    await flush();
    expect(storage.getItem(lastViewStorageKey(REPO))).toBeNull();
  });

  it("debounces several saves into one write of the last view", async () => {
    const { store, storage, timers } = setup();
    store.setEnabled(true, { note: null, folders: [] });
    await flush();
    const before = storage.writes;
    store.save({ note: ["a"], folders: [] });
    store.save({ note: ["b"], folders: [] });
    store.save(view);
    expect(timers.count).toBe(1);
    expect(storage.writes).toBe(before);
    timers.fire();
    await flush();
    expect(storage.writes).toBe(before + 1);
    expect(await store.load()).toEqual(view);
  });

  it("uses the default delay constant", () => {
    expect(LAST_VIEW_SAVE_DELAY_MS).toBe(500);
  });

  it("writes nothing when saving while disabled", async () => {
    const { store, storage, timers } = setup();
    store.save(view);
    expect(timers.count).toBe(0);
    timers.fire();
    await flush();
    expect(storage.writes).toBe(0);
    expect(storage.getItem(lastViewStorageKey(REPO))).toBeNull();
  });

  it("roundtrips nested folders and a note with Polish characters", async () => {
    const { store, timers } = setup();
    store.setEnabled(true, { note: null, folders: [] });
    store.save(view);
    timers.fire();
    await flush();
    expect(await store.load()).toEqual(view);
  });

  it("never stores a plaintext segment", async () => {
    const { store, storage, timers } = setup();
    store.setEnabled(true, view);
    store.save(view);
    timers.fire();
    await flush();
    const raw = storage.getItem(lastViewStorageKey(REPO))!;
    for (const segment of ["Projects", "Alpha", POLISH]) {
      expect(raw).not.toContain(segment);
    }
  });

  it("returns an empty view when loaded with a different keyring", async () => {
    const { store, storage, timers } = setup();
    store.setEnabled(true, { note: null, folders: [] });
    store.save(view);
    timers.fire();
    await flush();
    const foreign = createLastViewStore({
      repoKey: REPO,
      keyring: otherKeyring,
      storage,
    });
    expect(await foreign.load()).toEqual({ note: null, folders: [] });
  });

  it("drops root paths and unencodable segments when saving", async () => {
    const { store, timers } = setup();
    store.setEnabled(true, { note: null, folders: [] });
    store.save({ note: [], folders: [[], [""], ["Ok"]] });
    timers.fire();
    await flush();
    expect(await store.load()).toEqual({ note: null, folders: [["Ok"]] });
  });

  it("treats corrupt JSON and a wrong version as off", async () => {
    const { store, storage } = setup();
    const key = lastViewStorageKey(REPO);
    storage.setItem(key, "{not json");
    expect(store.isEnabled()).toBe(false);
    expect(await store.load()).toBeNull();
    storage.setItem(
      key,
      JSON.stringify({
        version: 2,
        reopenLastView: true,
        note: null,
        folders: [],
      }),
    );
    expect(store.isEnabled()).toBe(false);
    expect(await store.load()).toBeNull();
    storage.setItem(
      key,
      JSON.stringify({
        version: 1,
        reopenLastView: false,
        note: null,
        folders: [],
      }),
    );
    expect(store.isEnabled()).toBe(false);
    expect(await store.load()).toBeNull();
  });

  it("keeps repositories separate", async () => {
    const storage = new MemoryStorage();
    const a = setup({ storage, repoKey: "github:a/one" });
    const b = setup({ storage, repoKey: "github:b/two" });
    a.store.setEnabled(true, { note: null, folders: [] });
    a.store.save(view);
    a.timers.fire();
    await flush();
    expect(b.store.isEnabled()).toBe(false);
    expect(await b.store.load()).toBeNull();
    expect(await a.store.load()).toEqual(view);
  });

  it("drops a pending write on dispose but keeps the entry", async () => {
    const { store, storage, timers } = setup();
    store.setEnabled(true, { note: null, folders: [] });
    await flush();
    const before = storage.writes;
    store.save(view);
    store.dispose();
    expect(timers.count).toBe(0);
    timers.fire();
    await flush();
    expect(storage.writes).toBe(before);
    expect(store.isEnabled()).toBe(true);
  });

  it("removeLastView clears the entry", () => {
    const { store, storage } = setup();
    store.setEnabled(true, { note: null, folders: [] });
    removeLastView(REPO, storage);
    expect(storage.getItem(lastViewStorageKey(REPO))).toBeNull();
  });

  it("never throws when storage throws", async () => {
    const throwing = new ThrowingStorage();
    const { store, timers } = setup({ storage: throwing });
    expect(store.isEnabled()).toBe(false);
    expect(() => store.setEnabled(true, view)).not.toThrow();
    expect(() => store.save(view)).not.toThrow();
    expect(await store.load()).toBeNull();
    expect(() => store.setEnabled(false, view)).not.toThrow();
    expect(() => removeLastView(REPO, throwing)).not.toThrow();
    expect(() => store.dispose()).not.toThrow();
    timers.fire();
    await flush();
  });

  it("works without any storage", async () => {
    const { store } = setup({ storage: null });
    expect(store.isEnabled()).toBe(false);
    expect(() => store.setEnabled(true, view)).not.toThrow();
    expect(await store.load()).toBeNull();
  });
});
