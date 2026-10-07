import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { testKeyring } from "../crypto/testing/test-keyring";
import { encodeNotePath, noteFragmentOf } from "./note-fragment";
import {
  clearNoteFragment,
  createNoteNavigation,
  type NavigationEntry,
} from "./note-navigation";

const ORIGIN = "https://app.test";
const SESSION = "session-a";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await testKeyring();
});

interface HistoryEntry {
  state: unknown;
  url: string;
}

class FakeBrowser {
  readonly events = new EventTarget();
  readonly entries: HistoryEntry[];
  readonly writes: {
    method: "push" | "replace";
    state: unknown;
    url: string;
  }[] = [];
  index = 0;
  listeners = 0;

  constructor(url = "/app/?x=1", state: unknown = null) {
    this.entries = [{ state, url }];
    const add = this.events.addEventListener.bind(this.events);
    const remove = this.events.removeEventListener.bind(this.events);
    this.events.addEventListener = (
      ...args: Parameters<EventTarget["addEventListener"]>
    ) => {
      this.listeners++;
      add(...args);
    };
    this.events.removeEventListener = (
      ...args: Parameters<EventTarget["removeEventListener"]>
    ) => {
      this.listeners--;
      remove(...args);
    };
  }

  get entry(): HistoryEntry {
    return this.entries[this.index];
  }

  get location(): Pick<Location, "hash" | "pathname" | "search"> {
    const parsed = (): URL => new URL(this.entry.url, ORIGIN);
    return {
      get hash() {
        return parsed().hash;
      },
      get pathname() {
        return parsed().pathname;
      },
      get search() {
        return parsed().search;
      },
    };
  }

  readonly history = ((owner: FakeBrowser) => ({
    get state(): unknown {
      return owner.entry.state;
    },
    pushState: (state: unknown, _title: string, url?: string | URL | null) => {
      expect(url).toEqual(expect.any(String));
      this.writes.push({ method: "push", state, url: url as string });
      this.entries.splice(this.index + 1);
      this.entries.push({ state: structuredClone(state), url: url as string });
      this.index++;
    },
    replaceState: (
      state: unknown,
      _title: string,
      url?: string | URL | null,
    ) => {
      expect(url).toEqual(expect.any(String));
      this.writes.push({ method: "replace", state, url: url as string });
      this.entries[this.index] = {
        state: structuredClone(state),
        url: url as string,
      };
    },
    back: () => {
      if (this.index === 0) return;
      this.index--;
      this.dispatchPopState();
    },
  }))(this);

  editHash(hash: string): void {
    const url = new URL(this.entry.url, ORIGIN);
    url.hash = hash;
    this.entries.splice(this.index + 1);
    this.entries.push({
      state: null,
      url: url.pathname + url.search + url.hash,
    });
    this.index++;
    this.dispatchPopState();
  }

  dispatchPopState(): void {
    const event = Object.assign(new Event("popstate"), {
      state: structuredClone(this.entry.state),
    });
    this.events.dispatchEvent(event);
  }
}

let current: FakeBrowser;

function setup(url?: string, state?: unknown, sessionId = SESSION) {
  current = new FakeBrowser(url, state);
  const fake = current;
  const popped: NavigationEntry[] = [];
  const navigation = createNoteNavigation({
    keyring,
    history: fake.history as unknown as History,
    location: fake.location,
    events: fake.events as unknown as Window,
    onPopState: (entry) => popped.push(entry),
    sessionId,
  });
  return { fake, navigation, popped };
}

async function fragmentOf(path: string[]): Promise<string> {
  return noteFragmentOf(await encodeNotePath(keyring, path));
}

async function storedOf(path: string[]): Promise<string> {
  return encodeNotePath(keyring, path);
}

const note = (...path: string[]): NavigationEntry => ({ kind: "note", path });

describe("initial", () => {
  it("is none without a hash and stamps depth 0", async () => {
    const { fake, navigation } = setup("/app/?x=1");
    expect(await navigation.initial()).toEqual({ kind: "none" });
    expect(fake.entries).toEqual([
      { state: { nav: { session: SESSION, depth: 0 } }, url: "/app/?x=1" },
    ]);
    expect(navigation.canGoBack()).toBe(false);
  });

  it("decodes a valid fragment and keeps it", async () => {
    const fragment = await fragmentOf(["Folder", "Zażółć.md"]);
    const { fake, navigation } = setup(`/app/${fragment}`);
    expect(await navigation.initial()).toEqual(note("Folder", "Zażółć.md"));
    expect(navigation.current()).toEqual(note("Folder", "Zażółć.md"));
    expect(fake.entries).toEqual([
      {
        state: { note: fragment.slice(3), nav: { session: SESSION, depth: 0 } },
        url: `/app/${fragment}`,
      },
    ]);
  });

  it.each(["#n=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "#n=abc//def"])(
    "turns the fragment %s into none and removes it",
    async (hash) => {
      const { fake, navigation } = setup(`/app/?x=1${hash}`);
      expect(await navigation.initial()).toEqual({ kind: "none" });
      expect(fake.entry.url).toBe("/app/?x=1");
    },
  );

  it("treats a stale draft state as none", async () => {
    const { fake, navigation } = setup("/app/", {
      draft: true,
      nav: { session: "old", depth: 3 },
    });
    expect(await navigation.initial()).toEqual({ kind: "none" });
    expect(fake.entry).toEqual({
      state: { nav: { session: SESSION, depth: 0 } },
      url: "/app/",
    });
  });

  it("leaves a non-note hash untouched", async () => {
    const { fake, navigation } = setup("/app/#other");
    expect(await navigation.initial()).toEqual({ kind: "none" });
    expect(fake.entry.url).toBe("/app/#other");
  });
});

describe("push and replace", () => {
  it("pushes the fragment URL and state with increasing depth", async () => {
    const { fake, navigation } = setup("/app/?x=1");
    await navigation.initial();
    navigation.push(note("a.md"));
    expect(navigation.current()).toEqual(note("a.md"));
    expect(navigation.canGoBack()).toBe(true);
    await vi.waitFor(() => expect(fake.entries).toHaveLength(2));
    const stored = await storedOf(["a.md"]);
    expect(fake.entry).toEqual({
      state: { note: stored, nav: { session: SESSION, depth: 1 } },
      url: `/app/?x=1#n=${stored}`,
    });

    navigation.push({ kind: "draft" });
    await vi.waitFor(() => expect(fake.entries).toHaveLength(3));
    expect(fake.entry).toEqual({
      state: { draft: true, nav: { session: SESSION, depth: 2 } },
      url: "/app/?x=1",
    });
  });

  it("dedupes a push equal to the current entry", async () => {
    const { fake, navigation } = setup();
    await navigation.initial();
    navigation.push({ kind: "none" });
    navigation.push(note("a", "b.md"));
    navigation.push(note("a", "b.md"));
    navigation.push({ kind: "draft" });
    navigation.push({ kind: "draft" });
    await vi.waitFor(() => expect(fake.entries).toHaveLength(3));
    expect(fake.writes.filter((w) => w.method === "push")).toHaveLength(2);
  });

  it("replaces in place and keeps the depth", async () => {
    const { fake, navigation } = setup("/app/");
    await navigation.initial();
    navigation.push(note("a.md"));
    navigation.replace(note("b.md"));
    expect(navigation.current()).toEqual(note("b.md"));
    const stored = await storedOf(["b.md"]);
    await vi.waitFor(() =>
      expect(fake.entry).toEqual({
        state: { note: stored, nav: { session: SESSION, depth: 1 } },
        url: `/app/#n=${stored}`,
      }),
    );
    expect(fake.entries).toHaveLength(2);

    navigation.replace({ kind: "none" });
    await vi.waitFor(() =>
      expect(fake.entry).toEqual({
        state: { nav: { session: SESSION, depth: 1 } },
        url: "/app/",
      }),
    );
    expect(fake.entries).toHaveLength(2);
  });

  it("writes none when encoding fails", async () => {
    const { fake, navigation } = setup("/app/");
    await navigation.initial();
    navigation.push(note("a", ""));
    await vi.waitFor(() => expect(fake.entries).toHaveLength(2));
    expect(fake.entry).toEqual({
      state: { nav: { session: SESSION, depth: 1 } },
      url: "/app/",
    });

    navigation.push(note("ok.md"));
    await vi.waitFor(() => expect(fake.entries).toHaveLength(3));
  });

  it("reaches history in call order for rapid push, push, replace", async () => {
    const { fake, navigation } = setup("/app/");
    await navigation.initial();
    navigation.push(note("first.md"));
    navigation.push(note("second.md"));
    navigation.replace(note("third.md"));
    await vi.waitFor(() => expect(fake.writes).toHaveLength(4));
    const [first, second, third] = await Promise.all(
      [["first.md"], ["second.md"], ["third.md"]].map(storedOf),
    );
    expect(fake.writes.slice(1).map((w) => [w.method, w.url, w.state])).toEqual(
      [
        [
          "push",
          `/app/#n=${first}`,
          { note: first, nav: { session: SESSION, depth: 1 } },
        ],
        [
          "push",
          `/app/#n=${second}`,
          { note: second, nav: { session: SESSION, depth: 2 } },
        ],
        [
          "replace",
          `/app/#n=${third}`,
          { note: third, nav: { session: SESSION, depth: 2 } },
        ],
      ],
    );
  });
});

describe("popstate", () => {
  it("reports the previous note on back and stops at depth 0", async () => {
    const { fake, navigation, popped } = setup("/app/");
    await navigation.initial();
    navigation.push(note("a.md"));
    navigation.push(note("b.md"));
    navigation.back();
    await vi.waitFor(() => expect(popped).toEqual([note("a.md")]));
    expect(navigation.current()).toEqual(note("a.md"));
    expect(navigation.canGoBack()).toBe(true);
    expect(fake.index).toBe(1);

    navigation.back();
    await vi.waitFor(() => expect(popped).toHaveLength(2));
    expect(popped[1]).toEqual({ kind: "none" });
    expect(navigation.canGoBack()).toBe(false);
    expect(fake.writes).toHaveLength(3);
  });

  it("reports a draft entry as draft", async () => {
    const { navigation, popped } = setup("/app/");
    await navigation.initial();
    navigation.push({ kind: "draft" });
    navigation.push(note("a.md"));
    navigation.back();
    await vi.waitFor(() => expect(popped).toEqual([{ kind: "draft" }]));
    expect(navigation.current()).toEqual({ kind: "draft" });
    expect(navigation.canGoBack()).toBe(true);
  });

  it("re-stamps a foreign entry at depth 0 and keeps its URL", async () => {
    const fragment = await fragmentOf(["old.md"]);
    const { fake, navigation, popped } = setup(`/app/${fragment}`, {
      note: fragment.slice(3),
      nav: { session: "other", depth: 4 },
    });
    fake.entries.unshift({
      state: { note: fragment.slice(3), nav: { session: "other", depth: 3 } },
      url: `/app/${fragment}`,
    });
    fake.index = 1;
    await navigation.initial();
    navigation.back();
    await vi.waitFor(() => expect(popped).toEqual([note("old.md")]));
    expect(fake.entries[0]).toEqual({
      state: { note: fragment.slice(3), nav: { session: SESSION, depth: 0 } },
      url: `/app/${fragment}`,
    });
    expect(navigation.canGoBack()).toBe(false);
  });

  it("decodes a hand-edited hash from the URL", async () => {
    const { fake, navigation, popped } = setup("/app/");
    await navigation.initial();
    const fragment = await fragmentOf(["Notatki", "Łódź.md"]);
    fake.editHash(fragment);
    await vi.waitFor(() =>
      expect(popped).toEqual([note("Notatki", "Łódź.md")]),
    );
    expect(fake.entry).toEqual({
      state: { note: fragment.slice(3), nav: { session: SESSION, depth: 0 } },
      url: `/app/${fragment}`,
    });
    expect(navigation.canGoBack()).toBe(false);
  });

  it("reports an undecodable note as none and replaces it", async () => {
    const { fake, navigation, popped } = setup("/app/");
    await navigation.initial();
    fake.editHash("#n=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    await vi.waitFor(() => expect(popped).toEqual([{ kind: "none" }]));
    expect(fake.entry).toEqual({
      state: { nav: { session: SESSION, depth: 0 } },
      url: "/app/",
    });
    expect(navigation.current()).toEqual({ kind: "none" });
  });

  it("does not throw out of the handler when the consumer throws", async () => {
    current = new FakeBrowser("/app/");
    const fake = current;
    const navigation = createNoteNavigation({
      keyring,
      history: fake.history as unknown as History,
      location: fake.location,
      events: fake.events as unknown as Window,
      onPopState: () => {
        throw new Error("boom");
      },
      sessionId: SESSION,
    });
    await navigation.initial();
    navigation.push(note("a.md"));
    navigation.back();
    navigation.push(note("b.md"));
    await vi.waitFor(() => expect(fake.entries).toHaveLength(2));
    expect(fake.index).toBe(1);
  });

  it("stops listening after dispose", async () => {
    const { fake, navigation, popped } = setup("/app/");
    expect(fake.listeners).toBe(1);
    await navigation.initial();
    navigation.push(note("a.md"));
    await vi.waitFor(() => expect(fake.entries).toHaveLength(2));
    navigation.dispose();
    expect(fake.listeners).toBe(0);
    fake.history.back();
    navigation.push(note("b.md"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(popped).toEqual([]);
    expect(fake.writes).toHaveLength(2);
  });
});

describe("clearNoteFragment", () => {
  it("removes a note fragment", () => {
    const fake = new FakeBrowser("/app/?x=1#n=abc");
    current = fake;
    clearNoteFragment(fake.history, fake.location);
    expect(fake.entry).toEqual({ state: {}, url: "/app/?x=1" });
  });

  it.each(["/app/?x=1", "/app/#share=abc", "/app/#other"])(
    "leaves %s alone",
    (url) => {
      const fake = new FakeBrowser(url);
      current = fake;
      clearNoteFragment(fake.history, fake.location);
      expect(fake.writes).toEqual([]);
    },
  );
});

describe("plaintext", () => {
  it("never appears in any URL or state", async () => {
    const names = ["Tajny folder", "Zażółć gęślą.md", "draft-plan.md"];
    const fragment = await fragmentOf([names[0], names[1]]);
    const { fake, navigation, popped } = setup(`/app/${fragment}`);
    await navigation.initial();
    navigation.push(note(names[2]));
    navigation.push({ kind: "draft" });
    navigation.replace(note(names[0], names[2]));
    navigation.back();
    await vi.waitFor(() => expect(popped).toHaveLength(1));
    const written = JSON.stringify([fake.writes, fake.entries]);
    for (const name of [...names, "Tajny", "plan"]) {
      expect(written).not.toContain(name);
      expect(written).not.toContain(encodeURIComponent(name));
    }
  });
});
