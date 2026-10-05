import { describe, expect, it } from "vitest";
import type { NotePath } from "../../changes/change";
import type {
  CachedNoteDates,
  NoteDates,
  NoteDatesResolver,
} from "../../history/note-dates";
import { createTestClock } from "../../sync/testing/test-clock";
import {
  createNoteDatesView,
  type NoteDatesViewInput,
  type ShownNoteDates,
} from "./note-dates-view";

const DEBOUNCE_MS = 3000;
const PATH: NotePath = ["notes", "a.md"];
const OTHER_PATH: NotePath = ["notes", "b.md"];
const HEAD = "head-1";

const datesAt = (at: number): NoteDates => ({
  created: { at, exact: true },
  updated: at + 1,
});

interface PendingResolve {
  readonly path: NotePath;
  readonly head: string;
  readonly blobSha: string;
  settle(dates: NoteDates): Promise<void>;
}

function fakeResolver() {
  const cache = new Map<string, CachedNoteDates>();
  const forgotten: string[] = [];
  const pending: PendingResolve[] = [];
  const resolver: NoteDatesResolver = {
    cached: (path) => cache.get(path.join("/")) ?? null,
    forget: (path) => {
      forgotten.push(path.join("/"));
      cache.delete(path.join("/"));
    },
    resolve: (path, head, blobSha) =>
      new Promise<NoteDates>((resolve) => {
        pending.push({
          path,
          head,
          blobSha,
          settle: async (dates) => {
            resolve(dates);
            await Promise.resolve();
          },
        });
      }),
  };
  const seed = (path: NotePath, blobSha: string, dates: NoteDates): void => {
    cache.set(path.join("/"), { blobSha, commitSha: "commit", dates });
  };
  return { resolver, forgotten, pending, seed };
}

function setup() {
  const fake = fakeResolver();
  const clock = createTestClock();
  const shown: (ShownNoteDates | null)[] = [];
  const view = createNoteDatesView({
    resolver: fake.resolver,
    clock,
    debounceMs: DEBOUNCE_MS,
    onShow: (value) => shown.push(value),
  });
  const last = (): ShownNoteDates | null | undefined => shown.at(-1);
  return { ...fake, clock, shown, view, last };
}

function loaded(
  path: NotePath,
  blobSha: string,
  overrides: Partial<NoteDatesViewInput> = {},
): NoteDatesViewInput {
  return {
    key: path.join("/"),
    blobSha,
    idle: true,
    headHasOpenNote: true,
    open: {
      kind: "loaded",
      path,
      blobSha,
      content: "",
    },
    head: HEAD,
    ...overrides,
  };
}

describe("createNoteDatesView", () => {
  it("shows trusted cached dates at once without resolving", () => {
    const { view, seed, pending, forgotten, last } = setup();
    seed(PATH, "blob-1", datesAt(100));

    const cleanup = view.update(loaded(PATH, "blob-1"));

    expect(last()).toEqual({ path: PATH, dates: datesAt(100) });
    expect(pending).toHaveLength(0);
    expect(forgotten).toHaveLength(0);
    expect(cleanup).toBeUndefined();
  });

  it("forgets an entry resolved for another blob and resolves at once", async () => {
    const { view, seed, pending, forgotten, last } = setup();
    seed(PATH, "blob-old", datesAt(100));

    view.update(loaded(PATH, "blob-1"));

    expect(forgotten).toEqual([PATH.join("/")]);
    expect(last()).toBeNull();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      path: PATH,
      head: HEAD,
      blobSha: "blob-1",
    });

    await pending[0]!.settle(datesAt(200));
    expect(last()).toEqual({ path: PATH, dates: datesAt(200) });
  });

  it("does not trust the cache when the note was not first opened from its committed blob", () => {
    const { view, seed, pending, forgotten } = setup();
    seed(PATH, "blob-1", datesAt(100));

    view.update(
      loaded(PATH, "blob-1", { blobSha: null, headHasOpenNote: false }),
    );
    view.update(loaded(PATH, "blob-1"));

    expect(forgotten).toEqual([PATH.join("/")]);
    expect(pending).toHaveLength(1);
  });

  it("trusts the cache only for the first note opened", () => {
    const { view, seed, pending, forgotten } = setup();
    seed(PATH, "blob-1", datesAt(100));
    seed(OTHER_PATH, "blob-2", datesAt(200));
    view.update(loaded(PATH, "blob-1"));

    view.update(loaded(OTHER_PATH, "blob-2"));

    expect(forgotten).toEqual([OTHER_PATH.join("/")]);
    expect(pending.map((p) => p.blobSha)).toEqual(["blob-2"]);
  });

  it("waits until the note is in the head and a head is known", () => {
    const { view, pending, shown } = setup();

    view.update(loaded(PATH, "blob-1", { headHasOpenNote: false }));
    view.update(loaded(PATH, "blob-1", { head: undefined }));

    expect(shown).toEqual([null]);
    expect(pending).toHaveLength(0);
  });

  it("shows stale dates while re-resolving a saved note after the idle debounce", async () => {
    const { view, seed, pending, clock, last } = setup();
    seed(PATH, "blob-1", datesAt(100));
    view.update(loaded(PATH, "blob-1"));

    const cleanup = view.update(loaded(PATH, "blob-2"));

    expect(last()).toEqual({ path: PATH, dates: datesAt(100) });
    expect(cleanup).toBeTypeOf("function");
    clock.advance(DEBOUNCE_MS - 1);
    expect(pending).toHaveLength(0);
    clock.advance(1);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.blobSha).toBe("blob-2");

    await pending[0]!.settle(datesAt(300));
    expect(last()).toEqual({ path: PATH, dates: datesAt(300) });
  });

  it("does not re-resolve a saved note while a save is still in progress", () => {
    const { view, seed, pending, clock, last } = setup();
    seed(PATH, "blob-1", datesAt(100));
    view.update(loaded(PATH, "blob-1"));

    const cleanup = view.update(loaded(PATH, "blob-2", { idle: false }));

    expect(cleanup).toBeUndefined();
    expect(last()).toEqual({ path: PATH, dates: datesAt(100) });
    clock.advance(DEBOUNCE_MS * 2);
    expect(pending).toHaveLength(0);
  });

  it("resolves at once after a save when nothing is cached", () => {
    const { view, pending } = setup();
    view.update(loaded(PATH, "blob-1"));

    const cleanup = view.update(loaded(PATH, "blob-2", { idle: false }));

    expect(cleanup).toBeUndefined();
    expect(pending.map((p) => p.blobSha)).toEqual(["blob-1", "blob-2"]);
  });

  it("cancels the debounce timer on cleanup", () => {
    const { view, seed, pending, clock } = setup();
    seed(PATH, "blob-1", datesAt(100));
    view.update(loaded(PATH, "blob-1"));

    const cleanup = view.update(loaded(PATH, "blob-2"));
    cleanup!();
    clock.advance(DEBOUNCE_MS * 2);

    expect(pending).toHaveLength(0);
  });

  it("drops a late result from a previous opening", async () => {
    const { view, pending, last } = setup();
    view.update(loaded(PATH, "blob-1"));
    expect(pending).toHaveLength(1);

    view.update(loaded(OTHER_PATH, "blob-2"));
    await pending[0]!.settle(datesAt(100));

    expect(last()).toBeNull();
    await pending[1]!.settle(datesAt(200));
    expect(last()).toEqual({ path: OTHER_PATH, dates: datesAt(200) });
  });

  it("clears the shown dates when the note is closed", () => {
    const { view, seed, last } = setup();
    seed(PATH, "blob-1", datesAt(100));
    view.update(loaded(PATH, "blob-1"));

    view.update({
      key: null,
      blobSha: null,
      idle: true,
      headHasOpenNote: false,
      open: null,
      head: HEAD,
    });

    expect(last()).toBeNull();
  });
});
