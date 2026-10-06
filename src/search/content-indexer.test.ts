import { describe, expect, it, vi } from "vitest";
import type { NotePath } from "../changes/change";
import { NoteDecryptionError } from "../crypto/note-cipher";
import { ForgeError } from "../forge/errors";
import type { SearchSource } from "../sync/search-source";
import type { SyncEngineState } from "../sync/sync-engine";
import { createTestClock } from "../sync/testing/test-clock";
import { createContentIndexer } from "./content-indexer";
import type { IndexerEnvironment } from "./indexer-environment";

vi.mock("./search-tuning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./search-tuning")>()),
  INDEX_MEMORY_CAP_BYTES: 400,
}));

interface PendingRead {
  readonly sha: string;
  resolve(text: string): void;
  reject(error: unknown): void;
}

function blob(name: string, blobSha: string): SearchSource {
  return {
    path: [name] as NotePath,
    name,
    colorTag: null,
    content: { kind: "blob", blobSha },
  };
}

function local(name: string, text: string): SearchSource {
  return {
    path: [name] as NotePath,
    name,
    colorTag: null,
    content: { kind: "local", text },
  };
}

function createFakeEngine(initial: readonly SearchSource[]) {
  let sources = initial;
  let state = {
    workingTree: {},
    pending: [],
    inFlight: [],
    conflicts: [],
    openNote: null,
  } as unknown as SyncEngineState;
  const listeners = new Set<(state: SyncEngineState) => void>();
  const pending: PendingRead[] = [];
  const readCalls: string[] = [];
  let autoRead: ((sha: string) => string) | null = null;
  let searchSourcesCalls = 0;

  return {
    pending,
    readCalls,
    get searchSourcesCalls() {
      return searchSourcesCalls;
    },
    setAutoRead(fn: ((sha: string) => string) | null) {
      autoRead = fn;
    },
    setSources(next: readonly SearchSource[]) {
      sources = next;
      state = { ...state, workingTree: {} } as unknown as SyncEngineState;
      for (const listener of listeners) listener(state);
    },
    take(sha: string): PendingRead {
      const index = pending.findIndex((read) => read.sha === sha);
      if (index === -1) throw new Error(`no pending read for ${sha}`);
      return pending.splice(index, 1)[0];
    },
    getState: () => state,
    subscribe(listener: (state: SyncEngineState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    searchSources() {
      searchSourcesCalls++;
      return sources;
    },
    readNoteText(sha: string): Promise<string> {
      readCalls.push(sha);
      if (autoRead !== null) return Promise.resolve(autoRead(sha));
      return new Promise<string>((resolve, reject) => {
        pending.push({ sha, resolve, reject });
      });
    },
  };
}

function createFakeEnvironment() {
  let hidden = false;
  let online = true;
  const listeners = new Set<() => void>();
  const environment: IndexerEnvironment = {
    isHidden: () => hidden,
    isOnline: () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  function emit(): void {
    for (const listener of listeners) listener();
  }
  return {
    environment,
    listenerCount: () => listeners.size,
    setHidden(value: boolean) {
      hidden = value;
      emit();
    },
    setOnline(value: boolean) {
      online = value;
      emit();
    },
  };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

function setup(sources: readonly SearchSource[]) {
  const engine = createFakeEngine(sources);
  const clock = createTestClock(0);
  const env = createFakeEnvironment();
  const indexer = createContentIndexer({
    engine,
    clock,
    environment: env.environment,
  });
  return { engine, clock, env, indexer };
}

const shas = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `sha${i}`);

describe("createContentIndexer", () => {
  it("does nothing before the first open", async () => {
    const { engine, indexer } = setup([blob("a", "sha0")]);
    engine.setSources([blob("a", "sha0"), blob("b", "sha1")]);
    await flush();

    expect(engine.searchSourcesCalls).toBe(0);
    expect(engine.readCalls).toEqual([]);
    expect(indexer.getState()).toEqual({
      status: { kind: "idle" },
      unreadable: 0,
    });
  });

  it("indexes local text without reading", () => {
    const source = local("a", "Zażółć");
    const { engine, indexer } = setup([source]);
    indexer.open();

    expect(engine.readCalls).toEqual([]);
    expect(indexer.contentFor(source)).toEqual({
      text: "Zażółć",
      folded: "zazolc",
    });
    expect(indexer.getState().status).toEqual({ kind: "complete" });
  });

  it("reads in source order with at most three in flight", async () => {
    const sources = shas(5).map((sha, i) => blob(`n${i}`, sha));
    const { engine, indexer } = setup(sources);
    indexer.open();

    expect(engine.readCalls).toEqual(["sha0", "sha1", "sha2"]);
    expect(indexer.getState().status).toEqual({
      kind: "indexing",
      done: 0,
      total: 5,
    });

    engine.take("sha1").resolve("one");
    await flush();
    expect(engine.readCalls).toEqual(["sha0", "sha1", "sha2", "sha3"]);
    expect(engine.pending).toHaveLength(3);

    for (const sha of ["sha0", "sha2", "sha3"]) engine.take(sha).resolve(sha);
    await flush();
    expect(engine.readCalls).toEqual(shas(5));
    engine.take("sha4").resolve("four");
    await flush();

    expect(indexer.contentFor(sources[1])?.text).toBe("one");
    expect(indexer.getState().status).toEqual({ kind: "complete" });
  });

  it("delays the 121st read within a minute", async () => {
    const sources = shas(121).map((sha, i) => blob(`n${i}`, sha));
    const { engine, clock, indexer } = setup(sources);
    engine.setAutoRead(() => "");
    indexer.open();
    await flush();
    expect(engine.readCalls).toHaveLength(120);

    clock.advance(59_999);
    await flush();
    expect(engine.readCalls).toHaveLength(120);

    clock.advance(1);
    await flush();
    expect(engine.readCalls).toHaveLength(121);
    expect(indexer.getState().status).toEqual({ kind: "complete" });
  });

  it("pauses on RateLimited and resumes after the pause", async () => {
    const { engine, clock, indexer } = setup([
      blob("a", "sha0"),
      blob("b", "sha1"),
      blob("c", "sha2"),
      blob("d", "sha3"),
    ]);
    indexer.open();
    engine
      .take("sha0")
      .reject(new ForgeError("RateLimited", { retryAfterMs: 5_000 }));
    await flush();

    const status = indexer.getState().status;
    expect(status.kind).toBe("paused");
    expect(status.kind === "paused" && status.resumeAt).toBeGreaterThanOrEqual(
      60_000,
    );
    expect(engine.readCalls).toEqual(["sha0", "sha1", "sha2"]);

    clock.advance(60_000);
    await flush();
    expect(engine.readCalls).toEqual(["sha0", "sha1", "sha2", "sha0"]);
    expect(indexer.getState().status.kind).toBe("indexing");
  });

  it("retries Network errors with back-off, then counts the note unreadable", async () => {
    const { engine, clock, indexer } = setup([blob("a", "sha0")]);
    indexer.open();
    const countReads = () => engine.readCalls.length;

    engine.take("sha0").reject(new ForgeError("Network"));
    await flush();
    clock.advance(999);
    await flush();
    expect(countReads()).toBe(1);
    clock.advance(1);
    await flush();
    expect(countReads()).toBe(2);

    engine.take("sha0").reject(new ForgeError("Server"));
    await flush();
    clock.advance(1_999);
    await flush();
    expect(countReads()).toBe(2);
    clock.advance(1);
    await flush();
    expect(countReads()).toBe(3);

    engine.take("sha0").reject(new ForgeError("Network"));
    await flush();
    clock.advance(3_999);
    await flush();
    expect(countReads()).toBe(3);
    clock.advance(1);
    await flush();
    expect(countReads()).toBe(4);

    engine.take("sha0").reject(new ForgeError("Network"));
    await flush();
    clock.advance(10_000);
    await flush();
    expect(countReads()).toBe(4);
    expect(indexer.getState()).toEqual({
      status: { kind: "complete" },
      unreadable: 1,
    });
  });

  it("marks decryption failures unreadable and NotFound skipped", async () => {
    const { engine, indexer } = setup([blob("a", "sha0"), blob("b", "sha1")]);
    indexer.open();
    engine.take("sha0").reject(new NoteDecryptionError("bad"));
    engine.take("sha1").reject(new ForgeError("NotFound"));
    await flush();

    expect(indexer.getState()).toEqual({
      status: { kind: "complete" },
      unreadable: 1,
    });
    expect(engine.readCalls).toEqual(["sha0", "sha1"]);

    indexer.close();
    indexer.open();
    expect(engine.readCalls).toEqual(["sha0", "sha1", "sha0", "sha1"]);
  });

  it("stops in idle on Unauthorized and resumes on the next open", async () => {
    const sources = shas(5).map((sha, i) => blob(`n${i}`, sha));
    const { engine, indexer } = setup(sources);
    indexer.open();
    engine.take("sha0").reject(new ForgeError("Unauthorized"));
    await flush();

    expect(indexer.getState().status).toEqual({ kind: "idle" });
    engine.take("sha1").resolve("one");
    await flush();
    expect(engine.readCalls).toEqual(["sha0", "sha1", "sha2"]);

    indexer.close();
    indexer.open();
    expect(engine.readCalls).toEqual(["sha0", "sha1", "sha2", "sha0", "sha3"]);
  });

  it("holds new reads while hidden and resumes when visible", async () => {
    const { engine, env, indexer } = setup([
      blob("a", "sha0"),
      blob("b", "sha1"),
      blob("c", "sha2"),
      blob("d", "sha3"),
    ]);
    indexer.open();
    env.setHidden(true);
    engine.take("sha0").resolve("zero");
    await flush();
    expect(engine.readCalls).toEqual(["sha0", "sha1", "sha2"]);

    env.setHidden(false);
    expect(engine.readCalls).toEqual(["sha0", "sha1", "sha2", "sha3"]);
  });

  it("reports offline while work remains", async () => {
    const { engine, env, indexer } = setup([
      blob("a", "sha0"),
      blob("b", "sha1"),
      blob("c", "sha2"),
      blob("d", "sha3"),
    ]);
    indexer.open();
    env.setOnline(false);
    expect(indexer.getState().status).toEqual({ kind: "offline" });

    engine.take("sha0").resolve("zero");
    await flush();
    expect(engine.readCalls).toHaveLength(3);

    env.setOnline(true);
    expect(engine.readCalls).toHaveLength(4);
    expect(indexer.getState().status.kind).toBe("indexing");
  });

  it("stops in limited at the memory cap and recovers after eviction", async () => {
    const big = "x".repeat(60);
    const sources = [blob("a", "sha0"), blob("b", "sha1"), blob("c", "sha2")];
    const { engine, indexer } = setup(sources);
    engine.setAutoRead(() => big);
    indexer.open();
    await flush();

    expect(indexer.getState().status).toEqual({
      kind: "limited",
      covered: 1,
      total: 3,
    });
    expect(indexer.contentFor(sources[0])?.text).toBe(big);

    engine.setSources([sources[1], sources[2]]);
    await flush();
    expect(indexer.contentFor(sources[0])).toBeUndefined();
    expect(indexer.contentFor(sources[1])?.text).toBe(big);
    expect(indexer.getState().status).toEqual({
      kind: "limited",
      covered: 1,
      total: 2,
    });
  });

  it("evicts content whose source disappeared", async () => {
    const sources = [blob("a", "sha0"), local("b", "local text")];
    const { engine, indexer } = setup(sources);
    engine.setAutoRead(() => "remote text");
    indexer.open();
    await flush();
    expect(indexer.contentFor(sources[0])?.text).toBe("remote text");

    engine.setSources([]);
    expect(indexer.sources()).toEqual([]);
    expect(indexer.contentFor(sources[0])).toBeUndefined();
    expect(indexer.contentFor(sources[1])).toBeUndefined();
  });

  it("re-folds local text only when it changes", async () => {
    const { engine, clock, indexer } = setup([local("a", "Hello")]);
    indexer.open();
    const first = indexer.contentFor(local("a", ""));

    engine.setSources([local("a", "Hello")]);
    expect(indexer.contentFor(local("a", ""))).toBe(first);

    clock.advance(250);
    engine.setSources([local("a", "Hello World")]);
    expect(indexer.contentFor(local("a", ""))).toEqual({
      text: "Hello World",
      folded: "hello world",
    });
  });

  it("finishes the first run after close but fetches nothing new while closed afterwards", async () => {
    const { engine, indexer } = setup([blob("a", "sha0"), blob("b", "sha1")]);
    engine.setAutoRead(() => "text");
    indexer.open();
    indexer.close();
    await flush();
    expect(engine.readCalls).toEqual(["sha0", "sha1"]);
    expect(indexer.getState().status).toEqual({ kind: "complete" });

    engine.setSources([
      blob("a", "sha0"),
      blob("b", "sha1"),
      blob("c", "sha2"),
    ]);
    await flush();
    expect(engine.readCalls).toEqual(["sha0", "sha1"]);

    indexer.open();
    await flush();
    expect(engine.readCalls).toEqual(["sha0", "sha1", "sha2"]);
  });

  it("keeps reading after close during the first run", async () => {
    const sources = shas(4).map((sha, i) => blob(`n${i}`, sha));
    const { engine, indexer } = setup(sources);
    indexer.open();
    indexer.close();
    engine.take("sha0").resolve("zero");
    await flush();
    expect(engine.readCalls).toEqual(["sha0", "sha1", "sha2", "sha3"]);
  });

  it("throttles recomputation to one per 250 ms while open", () => {
    const { engine, clock, indexer } = setup([]);
    indexer.open();
    expect(engine.searchSourcesCalls).toBe(1);

    engine.setSources([local("a", "1")]);
    expect(engine.searchSourcesCalls).toBe(2);
    engine.setSources([local("a", "2")]);
    engine.setSources([local("a", "3")]);
    expect(engine.searchSourcesCalls).toBe(2);

    clock.advance(249);
    expect(engine.searchSourcesCalls).toBe(2);
    clock.advance(1);
    expect(engine.searchSourcesCalls).toBe(3);
    expect(indexer.contentFor(local("a", ""))?.text).toBe("3");

    clock.advance(250);
    expect(engine.searchSourcesCalls).toBe(3);

    indexer.close();
    engine.setSources([local("a", "4")]);
    clock.advance(1_000);
    expect(engine.searchSourcesCalls).toBe(3);
  });

  it("discards an in-flight result and clears content on dispose", async () => {
    const sources = [blob("a", "sha0"), local("b", "text")];
    const { engine, env, indexer } = setup(sources);
    const listener = vi.fn();
    indexer.subscribe(listener);
    indexer.open();
    listener.mockClear();

    indexer.dispose();
    engine.take("sha0").resolve("late");
    await flush();

    expect(listener).not.toHaveBeenCalled();
    expect(indexer.contentFor(sources[0])).toBeUndefined();
    expect(indexer.contentFor(sources[1])).toBeUndefined();
    expect(indexer.getState().status).toEqual({ kind: "idle" });
    expect(env.listenerCount()).toBe(0);
  });
});
