import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NotePath } from "../changes/change";
import { argon2idDirect } from "../crypto/argon2";
import { deriveKeyring, type Keyring } from "../crypto/keyring";
import { decryptNote } from "../crypto/note-cipher";
import { parseRepoConfig } from "../crypto/repo-config";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { ForgeError } from "../forge/errors";
import type { CommitRequest, ForgeAdapter } from "../forge/forge-adapter";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../testing/sample-notes-repo/sample-source";
import { buildNoteTree, findNode } from "../tree/note-tree";
import { GITHUB_WRITE_LIMITS } from "../forge/github/github-adapter";
import { createRateBudget, type RateBudget } from "./rate-budget";
import { createTestClock } from "./testing/test-clock";
import { createSyncEngine, type SyncEngine } from "./sync-engine";

let keyring: Keyring;

beforeAll(async () => {
  const probe = await createSampleNotesRepoAdapter();
  const inspection = await probe.inspect();
  if (inspection.kind !== "populated" || inspection.main === null) {
    throw new Error("expected a populated sample notes repo");
  }
  const parsed = parseRepoConfig(inspection.main.repoConfigText ?? "");
  if (parsed.kind !== "valid") {
    throw new Error(`expected a valid repo config, got ${parsed.kind}`);
  }
  keyring = await deriveKeyring(
    SAMPLE_NOTES_REPO_PASSPHRASE,
    parsed.config.kdf,
    argon2idDirect,
  );
});

const START = 1_000_000;
const WELCOME = ["Welcome"];
const IDEAS = ["Projects", "commitnote", "Ideas"];

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly engine: SyncEngine;
  readonly adapter: ForgeAdapter;
  readonly commits: CommitRequest[];
  readonly requestTimes: number[];
  readonly start: string;
}

function wrap(inner: FakeForgeAdapter, commits: CommitRequest[]): ForgeAdapter {
  return {
    limits: inner.limits,
    commitCost: (changes) => inner.commitCost(changes),
    inspect: () => inner.inspect(),
    initialize: (configText, message) => inner.initialize(configText, message),
    getHead: () => inner.getHead(),
    listTree: (sha) => inner.listTree(sha),
    listCommits: (request) => inner.listCommits(request),
    readFileAt: (sha, path) => inner.readFileAt(sha, path),
    readBlob: (sha) => inner.readBlob(sha),
    commit: (request) => {
      commits.push(request);
      return inner.commit(request);
    },
  };
}

async function setup(options?: {
  readonly budget?: (clock: ReturnType<typeof createTestClock>) => RateBudget;
  readonly wireBudget?: boolean;
}): Promise<Harness> {
  const clock = createTestClock(START);
  const rateBudget = options?.budget?.(clock);
  const requestTimes: number[] = [];
  const fake = await createSampleNotesRepoAdapter({
    onContentCreatingRequest: () => {
      requestTimes.push(clock.now());
      if (options?.wireBudget) rateBudget?.record();
    },
  });
  const commits: CommitRequest[] = [];
  const adapter = wrap(fake, commits);
  const engine = createSyncEngine({ adapter, keyring, clock, rateBudget });
  await engine.refresh();
  return {
    fake,
    clock,
    engine,
    adapter,
    commits,
    requestTimes,
    start: await fake.getHead(),
  };
}

async function settle(engine: SyncEngine): Promise<void> {
  await vi.waitFor(
    () => {
      const state = engine.getState();
      expect(state.save.kind).not.toBe("saving");
      expect(state.refresh.inFlight).toBe(false);
    },
    { timeout: 5_000, interval: 2 },
  );
}

async function advance(h: Harness, ms: number): Promise<void> {
  h.clock.advance(ms);
  await settle(h.engine);
}

function okCommitCount(fake: FakeForgeAdapter, since: string): number {
  let count = 0;
  let current: string | null | undefined = fake.repo.getRef("main");
  while (current !== since && current != null) {
    count++;
    current = fake.repo.getCommit(current)?.parent;
  }
  return count;
}

async function mainContent(
  fake: FakeForgeAdapter,
  path: NotePath,
): Promise<string | undefined> {
  const tree = await buildNoteTree(
    await fake.listTree(await fake.getHead()),
    keyring,
  );
  const node = findNode(tree, path);
  if (node?.kind !== "note") return undefined;
  return decryptNote(keyring, await fake.readBlob(node.blobSha));
}

async function mainHasFolder(
  fake: FakeForgeAdapter,
  path: NotePath,
): Promise<boolean> {
  const tree = await buildNoteTree(
    await fake.listTree(await fake.getHead()),
    keyring,
  );
  return findNode(tree, path)?.kind === "folder";
}

function retryAtOf(engine: SyncEngine): number | null {
  const save = engine.getState().save;
  if (save.kind !== "waiting")
    throw new Error(`expected waiting, got ${save.kind}`);
  return save.retryAt;
}

function fullBudget(clock: ReturnType<typeof createTestClock>): RateBudget {
  const budget = createRateBudget(clock, GITHUB_WRITE_LIMITS);
  for (let index = 0; index < GITHUB_WRITE_LIMITS.perMinute; index++) {
    budget.record();
  }
  return budget;
}

describe("sync engine failure handling", () => {
  it("retries a network failure after the back-off delay", async () => {
    const h = await setup();
    h.fake.failNext("commit", new ForgeError("Network"));

    h.engine.editNote(WELCOME, "retried");
    await advance(h, 2_000);
    const failedAt = h.clock.now();

    const state = h.engine.getState();
    expect(state.save).toEqual({
      kind: "waiting",
      reason: "failed",
      retryAt: failedAt + 5_000,
      error: { kind: "network" },
    });
    expect(state.syncStates.stateOf(WELCOME)).toEqual({
      kind: "out-of-sync",
      reason: "failed",
    });

    await advance(h, 4_999);
    expect(h.commits).toHaveLength(1);
    await advance(h, 1);
    expect(h.commits).toHaveLength(2);
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
    expect(await mainContent(h.fake, WELCOME)).toBe("retried");
  });

  it("doubles the back-off up to five minutes and resets it after a success", async () => {
    const h = await setup();
    const expected = [
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000,
    ];
    for (let index = 0; index < expected.length; index++) {
      h.fake.failNext("commit", new ForgeError("Network"));
    }

    h.engine.editNote(WELCOME, "eventually");
    await h.engine.flush();
    for (const delay of expected) {
      expect(retryAtOf(h.engine)).toBe(h.clock.now() + delay);
      await advance(h, delay);
    }
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
    expect(await mainContent(h.fake, WELCOME)).toBe("eventually");

    h.fake.failNext("commit", new ForgeError("Network"));
    h.engine.editNote(WELCOME, "again");
    await h.engine.flush();
    expect(retryAtOf(h.engine)).toBe(h.clock.now() + 5_000);
  });

  it("backs off as a server error after repeated stale results", async () => {
    const h = await setup();
    for (let index = 0; index < 3; index++) {
      h.fake.failNext("commit", "stale");
    }

    h.engine.editNote(WELCOME, "after stale");
    await h.engine.flush();
    expect(h.commits).toHaveLength(3);
    expect(h.engine.getState().save).toEqual({
      kind: "waiting",
      reason: "failed",
      retryAt: h.clock.now() + 5_000,
      error: { kind: "server" },
    });

    await advance(h, 5_000);
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
    expect(await mainContent(h.fake, WELCOME)).toBe("after stale");
  });

  it("waits at least a minute when rate limited, longer when told to", async () => {
    const h = await setup();
    h.fake.failNext(
      "commit",
      new ForgeError("RateLimited", { retryAfterMs: 10_000 }),
    );
    h.fake.failNext(
      "commit",
      new ForgeError("RateLimited", { retryAfterMs: 90_000 }),
    );

    h.engine.editNote(WELCOME, "limited");
    await h.engine.flush();
    expect(h.engine.getState().save).toEqual({
      kind: "waiting",
      reason: "failed",
      retryAt: h.clock.now() + 60_000,
      error: { kind: "rateLimited", retryAfterMs: 10_000 },
    });

    await advance(h, 60_000);
    expect(h.commits).toHaveLength(2);
    expect(retryAtOf(h.engine)).toBe(h.clock.now() + 90_000);

    await advance(h, 89_999);
    expect(h.commits).toHaveLength(2);
    await advance(h, 1);
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
    expect(await mainContent(h.fake, WELCOME)).toBe("limited");
  });

  it("includes edits made during back-off in the single retry commit", async () => {
    const h = await setup();
    h.fake.failNext("commit", new ForgeError("Server"));

    h.engine.editNote(WELCOME, "first");
    await h.engine.flush();
    const retryAt = retryAtOf(h.engine)!;

    h.engine.editNote(IDEAS, "second");
    await advance(h, 2_000);
    expect(h.engine.createFolder([], "Later").ok).toBe(true);
    await advance(h, retryAt - h.clock.now() - 1);
    expect(h.commits).toHaveLength(1);
    expect(h.engine.getState().pending).toHaveLength(4);

    await advance(h, 1);
    expect(h.commits).toHaveLength(2);
    expect(okCommitCount(h.fake, h.start)).toBe(1);
    expect(await mainContent(h.fake, WELCOME)).toBe("first");
    expect(await mainContent(h.fake, IDEAS)).toBe("second");
    expect(await mainHasFolder(h.fake, ["Later"])).toBe(true);
  });

  it("retryNow commits at once during back-off and does nothing otherwise", async () => {
    const h = await setup();
    h.engine.editNote(WELCOME, "debounced");
    h.engine.retryNow();
    await settle(h.engine);
    expect(h.commits).toHaveLength(0);
    expect(h.engine.getState().save).toEqual({ kind: "idle" });

    h.fake.failNext("commit", new ForgeError("Network"));
    await h.engine.flush();
    expect(h.engine.getState().save.kind).toBe("waiting");

    h.engine.retryNow();
    await settle(h.engine);
    expect(h.commits).toHaveLength(2);
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
    expect(await mainContent(h.fake, WELCOME)).toBe("debounced");

    await advance(h, 600_000);
    expect(h.commits).toHaveLength(2);
  });

  it("postpones a save until the rate budget allows it and coalesces edits", async () => {
    const h = await setup({ budget: fullBudget });

    h.engine.editNote(WELCOME, "budgeted");
    await advance(h, 2_000);
    let state = h.engine.getState();
    expect(h.commits).toHaveLength(0);
    expect(state.save).toEqual({
      kind: "waiting",
      reason: "rateBudget",
      retryAt: START + 60_000,
      error: null,
    });
    expect(state.syncStates.stateOf(WELCOME)).toEqual({
      kind: "out-of-sync",
      reason: "pending",
    });

    h.engine.editNote(IDEAS, "also budgeted");
    await advance(h, 2_000);
    expect(h.engine.createFolder([], "Budgeted").ok).toBe(true);
    await advance(h, START + 60_000 - h.clock.now() - 1);
    expect(h.commits).toHaveLength(0);

    await advance(h, 1);
    state = h.engine.getState();
    expect(state.save).toEqual({ kind: "idle" });
    expect(h.commits).toHaveLength(1);
    expect(okCommitCount(h.fake, h.start)).toBe(1);
    expect(await mainContent(h.fake, WELCOME)).toBe("budgeted");
    expect(await mainContent(h.fake, IDEAS)).toBe("also budgeted");
    expect(await mainHasFolder(h.fake, ["Budgeted"])).toBe(true);
  });

  it("keeps rapid structure commands within the minute budget", async () => {
    const h = await setup({
      budget: (clock) => createRateBudget(clock, GITHUB_WRITE_LIMITS),
      wireBudget: true,
    });

    for (let index = 0; index < 30; index++) {
      expect(h.engine.createFolder([], `Folder ${index}`).ok).toBe(true);
      await advance(h, 100);
    }
    for (let step = 0; step < 10; step++) {
      await advance(h, 30_000);
    }

    expect(h.engine.getState().pending).toEqual([]);
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
    for (let index = 0; index < 30; index++) {
      expect(await mainHasFolder(h.fake, [`Folder ${index}`])).toBe(true);
    }
    expect(h.requestTimes.length).toBeGreaterThan(60);
    for (const time of h.requestTimes) {
      const inWindow = h.requestTimes.filter(
        (other) => other <= time && other > time - 60_000,
      );
      expect(inWindow.length).toBeLessThanOrEqual(60);
    }
  });

  it("keeps the changes pending and retries when a save's access token is rejected", async () => {
    const h = await setup();
    h.fake.failNext("commit", new ForgeError("Unauthorized"));

    h.engine.editNote(WELCOME, "kept");
    await h.engine.flush();
    const save = h.engine.getState().save;
    expect(save).toEqual({
      kind: "waiting",
      reason: "failed",
      retryAt: expect.any(Number),
      error: { kind: "unauthorized" },
    });
    expect(h.engine.getState().pending).toEqual([
      { kind: "update-note", path: WELCOME, content: "kept" },
    ]);

    const retryAt = (save as { retryAt: number }).retryAt;
    await advance(h, retryAt - h.clock.now() + 1);
    await settle(h.engine);

    expect(h.engine.getState().save).toEqual({ kind: "idle" });
    expect(h.engine.getState().pending).toEqual([]);
    expect(okCommitCount(h.fake, h.start)).toBe(1);
    expect(await mainContent(h.fake, WELCOME)).toBe("kept");
  });

  it("reports a rejected refresh as a refresh error without stopping saves", async () => {
    const h = await setup();
    h.fake.failNext("getHead", new ForgeError("Unauthorized"));

    await h.engine.refresh();
    const state = h.engine.getState();
    expect(state.refresh.lastError).toEqual({ kind: "unauthorized" });
    expect(state.save.kind).toBe("idle");

    h.engine.editNote(WELCOME, "after refresh error");
    await h.engine.flush();
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
    expect(await mainContent(h.fake, WELCOME)).toBe("after refresh error");
  });

  it("flush bypasses back-off but not the rate budget", async () => {
    const backedOff = await setup();
    backedOff.fake.failNext("commit", new ForgeError("Network"));
    backedOff.engine.editNote(WELCOME, "flushed");
    expect(await backedOff.engine.flush()).toEqual({
      kind: "unsaved",
      count: 1,
    });
    expect(await backedOff.engine.flush()).toEqual({ kind: "saved" });
    expect(backedOff.commits).toHaveLength(2);
    expect(await mainContent(backedOff.fake, WELCOME)).toBe("flushed");

    const budgeted = await setup({ budget: fullBudget });
    budgeted.engine.editNote(WELCOME, "waits");
    await advance(budgeted, 2_000);
    const waiting = budgeted.engine.getState().save;
    expect(waiting.kind).toBe("waiting");

    expect(await budgeted.engine.flush()).toEqual({
      kind: "unsaved",
      count: 1,
    });
    expect(budgeted.commits).toHaveLength(0);
    expect(budgeted.engine.getState().save).toEqual(waiting);

    await advance(budgeted, 60_000);
    expect(budgeted.commits).toHaveLength(1);
    expect(await mainContent(budgeted.fake, WELCOME)).toBe("waits");
  });

  it("never commits after dispose during back-off", async () => {
    const h = await setup();
    h.fake.failNext("commit", new ForgeError("Network"));
    h.engine.editNote(WELCOME, "disposed");
    await h.engine.flush();
    expect(h.engine.getState().save.kind).toBe("waiting");

    h.engine.dispose();
    h.clock.advance(600_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.commits).toHaveLength(1);
    expect(okCommitCount(h.fake, h.start)).toBe(0);
  });
});
