import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { testKeyring } from "../crypto/testing/test-keyring";
import { encodeNotePath, noteFragmentOf } from "./note-fragment";
import {
  clearLaunchAction,
  clearNoteFragment,
  createNoteNavigation,
  type NavigationEntry,
} from "./note-navigation";

const WAIT = { timeout: 5000 };

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
  deferredPopStates: Event[] | null = null;

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
      this.history.go(-1);
    },
    go: (delta = 0) => {
      const target = this.index + delta;
      if (delta === 0 || target < 0 || target >= this.entries.length) return;
      this.index = target;
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
    if (this.deferredPopStates === null) this.events.dispatchEvent(event);
    else this.deferredPopStates.push(event);
  }

  deferPopStates(): void {
    this.deferredPopStates = [];
  }

  flushPopStates(): void {
    const events = this.deferredPopStates ?? [];
    this.deferredPopStates = null;
    for (const event of events) this.events.dispatchEvent(event);
  }
}

let current: FakeBrowser;

function setup(url?: string, state?: unknown, sessionId = SESSION) {
  current = new FakeBrowser(url, state);
  const fake = current;
  const popped: NavigationEntry[] = [];
  const dialogBacks: number[] = [];
  const navigation = createNoteNavigation({
    keyring,
    history: fake.history as unknown as History,
    location: fake.location,
    events: fake.events as unknown as Window,
    onPopState: (entry) => popped.push(entry),
    onDialogBack: (count) => dialogBacks.push(count),
    sessionId,
  });
  return { fake, navigation, popped, dialogBacks };
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
    await vi.waitFor(() => expect(fake.entries).toHaveLength(2), WAIT);
    const stored = await storedOf(["a.md"]);
    expect(fake.entry).toEqual({
      state: { note: stored, nav: { session: SESSION, depth: 1 } },
      url: `/app/?x=1#n=${stored}`,
    });

    navigation.push({ kind: "draft" });
    await vi.waitFor(() => expect(fake.entries).toHaveLength(3), WAIT);
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
    await vi.waitFor(() => expect(fake.entries).toHaveLength(3), WAIT);
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
      WAIT,
    );
    expect(fake.entries).toHaveLength(2);

    navigation.replace({ kind: "none" });
    await vi.waitFor(() =>
      expect(fake.entry).toEqual({
        state: { nav: { session: SESSION, depth: 1 } },
        url: "/app/",
      }),
      WAIT,
    );
    expect(fake.entries).toHaveLength(2);
  });

  it("writes none when encoding fails", async () => {
    const { fake, navigation } = setup("/app/");
    await navigation.initial();
    navigation.push(note("a", ""));
    await vi.waitFor(() => expect(fake.entries).toHaveLength(2), WAIT);
    expect(fake.entry).toEqual({
      state: { nav: { session: SESSION, depth: 1 } },
      url: "/app/",
    });

    navigation.push(note("ok.md"));
    await vi.waitFor(() => expect(fake.entries).toHaveLength(3), WAIT);
  });

  it("reaches history in call order for rapid push, push, replace", async () => {
    const { fake, navigation } = setup("/app/");
    await navigation.initial();
    navigation.push(note("first.md"));
    navigation.push(note("second.md"));
    navigation.replace(note("third.md"));
    await vi.waitFor(() => expect(fake.writes).toHaveLength(4), WAIT);
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
    await vi.waitFor(() => expect(popped).toEqual([note("a.md")]), WAIT);
    expect(navigation.current()).toEqual(note("a.md"));
    expect(navigation.canGoBack()).toBe(true);
    expect(fake.index).toBe(1);

    navigation.back();
    await vi.waitFor(() => expect(popped).toHaveLength(2), WAIT);
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
    await vi.waitFor(() => expect(popped).toEqual([{ kind: "draft" }]), WAIT);
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
    await vi.waitFor(() => expect(popped).toEqual([note("old.md")]), WAIT);
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
      WAIT,
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
    await vi.waitFor(() => expect(popped).toEqual([{ kind: "none" }]), WAIT);
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
    await vi.waitFor(() => expect(fake.entries).toHaveLength(2), WAIT);
    expect(fake.index).toBe(1);
  });

  it("stops listening after dispose", async () => {
    const { fake, navigation, popped } = setup("/app/");
    expect(fake.listeners).toBe(1);
    await navigation.initial();
    navigation.push(note("a.md"));
    await vi.waitFor(() => expect(fake.entries).toHaveLength(2), WAIT);
    navigation.dispose();
    expect(fake.listeners).toBe(0);
    fake.history.back();
    navigation.push(note("b.md"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(popped).toEqual([]);
    expect(fake.writes).toHaveLength(2);
  });
});

describe("dialog entries", () => {
  const nav = (depth: number) => ({ session: SESSION, depth });

  async function withDialogOver(path: string[]) {
    const setupResult = setup("/app/");
    const { fake, navigation } = setupResult;
    await navigation.initial();
    navigation.push(note(...path));
    navigation.pushDialog();
    await vi.waitFor(() => expect(fake.entries).toHaveLength(3), WAIT);
    return { ...setupResult, stored: await storedOf(path) };
  }

  it("pushes a same-URL dialog entry one level deeper without counting it for Back", async () => {
    const { fake, navigation } = setup("/app/?x=1");
    await navigation.initial();
    navigation.pushDialog();
    expect(navigation.openDialogs()).toBe(1);
    expect(navigation.canGoBack()).toBe(false);
    await vi.waitFor(() => expect(fake.entries).toHaveLength(2), WAIT);
    expect(fake.entry).toEqual({
      state: { dialog: true, nav: nav(1) },
      url: "/app/?x=1",
    });
    expect(navigation.canGoBack()).toBe(false);

    const { fake: other, stored } = await withDialogOver(["a.md"]);
    expect(other.entry).toEqual({
      state: { note: stored, dialog: true, nav: nav(2) },
      url: `/app/#n=${stored}`,
    });
    expect(other.entries[1].url).toBe(other.entry.url);
  });

  it("goes back one entry on consume and swallows its popstate", async () => {
    const { fake, navigation, popped, dialogBacks } = await withDialogOver([
      "a.md",
    ]);
    expect(navigation.canGoBack()).toBe(true);
    navigation.consumeDialog();
    expect(navigation.openDialogs()).toBe(0);
    await vi.waitFor(() => expect(fake.index).toBe(1), WAIT);
    navigation.push(note("b.md"));
    await vi.waitFor(() => expect(fake.index).toBe(2), WAIT);
    expect(popped).toEqual([]);
    expect(dialogBacks).toEqual([]);
    expect(navigation.current()).toEqual(note("b.md"));
  });

  it("ignores a consume without open dialog entries", async () => {
    const { fake, navigation, popped } = setup("/app/");
    await navigation.initial();
    navigation.push(note("a.md"));
    navigation.consumeDialog();
    navigation.push(note("b.md"));
    await vi.waitFor(() => expect(fake.entries).toHaveLength(3), WAIT);
    expect(fake.index).toBe(2);
    expect(popped).toEqual([]);
    expect(navigation.openDialogs()).toBe(0);
  });

  it("reports a system Back over a dialog entry as a dialog back", async () => {
    const { fake, navigation, popped, dialogBacks, stored } =
      await withDialogOver(["a.md"]);
    fake.history.back();
    await vi.waitFor(() => expect(dialogBacks).toEqual([1]), WAIT);
    expect(popped).toEqual([]);
    expect(fake.entry.url).toBe(`/app/#n=${stored}`);
    expect(navigation.openDialogs()).toBe(0);
    expect(navigation.current()).toEqual(note("a.md"));
    expect(navigation.canGoBack()).toBe(true);
  });

  it("closes nested dialogs one Back at a time before leaving the note", async () => {
    const { fake, navigation, popped, dialogBacks } = setup("/app/");
    await navigation.initial();
    navigation.push(note("a.md"));
    navigation.push(note("b.md"));
    navigation.pushDialog();
    navigation.pushDialog();
    expect(navigation.openDialogs()).toBe(2);
    await vi.waitFor(() => expect(fake.entries).toHaveLength(5), WAIT);

    fake.history.back();
    await vi.waitFor(() => expect(dialogBacks).toEqual([1]), WAIT);
    expect(navigation.openDialogs()).toBe(1);
    fake.history.back();
    await vi.waitFor(() => expect(dialogBacks).toEqual([1, 1]), WAIT);
    expect(popped).toEqual([]);
    fake.history.back();
    await vi.waitFor(() => expect(popped).toEqual([note("a.md")]), WAIT);
    expect(dialogBacks).toEqual([1, 1]);
    expect(navigation.openDialogs()).toBe(0);
  });

  it("reports every passed dialog when Back skips past them into an earlier note", async () => {
    const { fake, navigation, popped, dialogBacks } = setup("/app/");
    await navigation.initial();
    navigation.push(note("a.md"));
    navigation.push(note("b.md"));
    navigation.pushDialog();
    navigation.pushDialog();
    await vi.waitFor(() => expect(fake.entries).toHaveLength(5), WAIT);
    fake.history.go(-3);
    await vi.waitFor(() => expect(popped).toEqual([note("a.md")]), WAIT);
    expect(dialogBacks).toEqual([2]);
    expect(navigation.openDialogs()).toBe(0);
    expect(navigation.canGoBack()).toBe(true);
  });

  it("rewinds open dialog entries before a push", async () => {
    const { fake, navigation, popped, dialogBacks } = await withDialogOver([
      "a.md",
    ]);
    navigation.push(note("b.md"));
    expect(navigation.openDialogs()).toBe(0);
    const stored = await storedOf(["b.md"]);
    await vi.waitFor(() =>
      expect(fake.entry).toEqual({
        state: { note: stored, nav: nav(2) },
        url: `/app/#n=${stored}`,
      }),
      WAIT,
    );
    expect(fake.entries).toHaveLength(3);
    expect(fake.entries[1].state).toEqual({
      note: await storedOf(["a.md"]),
      nav: nav(1),
    });

    fake.history.back();
    await vi.waitFor(() => expect(popped).toEqual([note("a.md")]), WAIT);
    expect(dialogBacks).toEqual([]);
  });

  it("treats a consume after a rewinding push as a no-op", async () => {
    const { fake, navigation, popped } = await withDialogOver(["a.md"]);
    navigation.push(note("b.md"));
    navigation.consumeDialog();
    navigation.push(note("c.md"));
    await vi.waitFor(() => expect(fake.entries).toHaveLength(4), WAIT);
    expect(fake.index).toBe(3);
    expect(fake.entries[2].state).toEqual({
      note: await storedOf(["b.md"]),
      nav: nav(2),
    });
    expect(popped).toEqual([]);
  });

  it("writes a push queued after a consume only once the browser has landed", async () => {
    const { fake, navigation, popped, dialogBacks } = await withDialogOver([
      "a.md",
    ]);
    fake.deferPopStates();
    navigation.consumeDialog();
    navigation.push(note("b.md"));
    await vi.waitFor(() => expect(fake.index).toBe(1), WAIT);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.writes.filter((w) => w.method === "push")).toHaveLength(2);

    fake.flushPopStates();
    const stored = await storedOf(["b.md"]);
    await vi.waitFor(() =>
      expect(fake.entry).toEqual({
        state: { note: stored, nav: nav(2) },
        url: `/app/#n=${stored}`,
      }),
      WAIT,
    );
    expect(fake.entries).toHaveLength(3);
    expect(popped).toEqual([]);
    expect(dialogBacks).toEqual([]);
  });

  it("replaces the top dialog entry and rewrites the stale base after the consume", async () => {
    const { fake, navigation, popped } = await withDialogOver(["a.md"]);
    navigation.replace(note("b.md"));
    expect(navigation.current()).toEqual(note("b.md"));
    const stored = await storedOf(["b.md"]);
    await vi.waitFor(() =>
      expect(fake.entry).toEqual({
        state: { note: stored, dialog: true, nav: nav(2) },
        url: `/app/#n=${stored}`,
      }),
      WAIT,
    );
    expect(fake.entries[1].state).toEqual({
      note: await storedOf(["a.md"]),
      nav: nav(1),
    });

    navigation.consumeDialog();
    await vi.waitFor(() =>
      expect(fake.entries[1]).toEqual({
        state: { note: stored, nav: nav(1) },
        url: `/app/#n=${stored}`,
      }),
      WAIT,
    );
    expect(fake.index).toBe(1);
    expect(popped).toEqual([]);
  });

  it("rewrites the stale base when a system Back lands on it", async () => {
    const { fake, navigation, dialogBacks } = await withDialogOver(["a.md"]);
    navigation.replace(note("b.md"));
    const stored = await storedOf(["b.md"]);
    await vi.waitFor(() =>
      expect(fake.entry.url).toBe(`/app/#n=${stored}`),
      WAIT,
    );
    fake.history.back();
    await vi.waitFor(() => expect(dialogBacks).toEqual([1]), WAIT);
    expect(fake.entry).toEqual({
      state: { note: stored, nav: nav(1) },
      url: `/app/#n=${stored}`,
    });
  });

  it("re-stamps a stale dialog entry reached by Forward as a normal entry", async () => {
    const { fake, navigation, popped, dialogBacks, stored } =
      await withDialogOver(["a.md"]);
    fake.history.back();
    await vi.waitFor(() => expect(dialogBacks).toEqual([1]), WAIT);
    fake.history.go(1);
    await vi.waitFor(() => expect(popped).toEqual([note("a.md")]), WAIT);
    expect(fake.entry).toEqual({
      state: { note: stored, nav: nav(2) },
      url: `/app/#n=${stored}`,
    });
    expect(dialogBacks).toEqual([1]);
    expect(navigation.openDialogs()).toBe(0);

    navigation.push(note("b.md"));
    await vi.waitFor(() => expect(fake.entries).toHaveLength(4), WAIT);
    expect(fake.entry.state).toMatchObject({ nav: nav(3) });
  });

  it("strips the dialog flag on initial", async () => {
    const fragment = await fragmentOf(["a.md"]);
    const { fake, navigation } = setup(`/app/${fragment}`, {
      note: fragment.slice(3),
      dialog: true,
      nav: nav(2),
    });
    expect(await navigation.initial()).toEqual(note("a.md"));
    expect(fake.entry).toEqual({
      state: { note: fragment.slice(3), nav: nav(0) },
      url: `/app/${fragment}`,
    });
    expect(navigation.openDialogs()).toBe(0);
  });

  it("skips a dialog push made before initial and does not wait for its consume", async () => {
    const { fake, navigation, popped } = setup("/app/");
    navigation.pushDialog();
    await navigation.initial();
    navigation.consumeDialog();
    navigation.push(note("a.md"));
    await vi.waitFor(() => expect(fake.entries).toHaveLength(2), WAIT);
    expect(fake.index).toBe(1);
    expect(popped).toEqual([]);
  });

  it("releases a waiting consume on dispose", async () => {
    const { fake, navigation } = await withDialogOver(["a.md"]);
    fake.deferPopStates();
    navigation.consumeDialog();
    await vi.waitFor(() => expect(fake.index).toBe(1), WAIT);
    navigation.dispose();
    await expect(navigation.initial()).resolves.toEqual({ kind: "none" });
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

describe("clearLaunchAction", () => {
  it("removes only the action parameter and keeps the hash and state", () => {
    const fake = new FakeBrowser("/app/?x=1&action=search&y=2#n=abc", {
      keep: true,
    });
    current = fake;
    clearLaunchAction(fake.history, fake.location);
    expect(fake.entry).toEqual({
      state: { keep: true },
      url: "/app/?x=1&y=2#n=abc",
    });
  });

  it("drops the question mark when no parameters remain", () => {
    const fake = new FakeBrowser("/app/?action=new-note");
    current = fake;
    clearLaunchAction(fake.history, fake.location);
    expect(fake.entry.url).toBe("/app/");
  });

  it.each(["/app/", "/app/?x=1", "/app/#action=search"])(
    "leaves %s alone",
    (url) => {
      const fake = new FakeBrowser(url);
      current = fake;
      clearLaunchAction(fake.history, fake.location);
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
    await vi.waitFor(() => expect(popped).toHaveLength(1), WAIT);
    const written = JSON.stringify([fake.writes, fake.entries]);
    for (const name of [...names, "Tajny", "plan"]) {
      expect(written).not.toContain(name);
      expect(written).not.toContain(encodeURIComponent(name));
    }
  });
});
