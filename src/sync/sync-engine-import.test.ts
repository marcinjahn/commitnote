import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ChangeSet, NotePath } from "../changes/change";
import { readOrderIndex } from "../order/order-index";
import { encodeChangeSet } from "../changes/encode-change-set";
import { argon2idDirect } from "../crypto/argon2";
import {
  createRepoConfig,
  deriveKeyring,
  type Keyring,
} from "../crypto/keyring";
import { decryptNote } from "../crypto/note-cipher";
import { parseRepoConfig } from "../crypto/repo-config";
import { ForgeError } from "../forge/errors";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import type {
  AtomicCommitSupport,
  CommitRequest,
  ForgeAdapter,
} from "../forge/forge-adapter";
import { GITHUB_WRITE_LIMITS } from "../forge/github/github-adapter";
import { REPO_CONFIG_PATH } from "../format/v1";
import { planImport } from "../import/plan-import";
import type { ArchiveImportEntry } from "../import/read-notes-archive";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../testing/sample-notes-repo/sample-source";
import { buildNoteTree, findNode, type NoteTree } from "../tree/note-tree";
import { createRateBudget, type RateBudget } from "./rate-budget";
import { createSyncEngine, type SyncEngine } from "./sync-engine";
import { createTestClock } from "./testing/test-clock";

let keyring: Keyring;
let rekeyedConfigText: string;

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
  rekeyedConfigText = (
    await createRepoConfig("another passphrase", {
      argon2id: argon2idDirect,
      kdf: parsed.config.kdf,
    })
  ).configText;
});

const START = 1_000_000;
const WELCOME = ["Welcome"];

interface AtomicSetup {
  support: AtomicCommitSupport;
  readonly enableResult: AtomicCommitSupport;
}

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly costs: { readonly atomic: boolean }[];
  readonly clock: ReturnType<typeof createTestClock>;
  readonly engine: SyncEngine;
  readonly commits: CommitRequest[];
  readonly start: string;
}

async function setup(options?: {
  readonly budget?: (clock: ReturnType<typeof createTestClock>) => RateBudget;
  // Mimics a forge where atomic commits need a settings change first.
  readonly atomic?: AtomicSetup;
}): Promise<Harness> {
  const clock = createTestClock(START);
  const fake = await createSampleNotesRepoAdapter();
  const commits: CommitRequest[] = [];
  const costs: { atomic: boolean }[] = [];
  const atomic = options?.atomic;
  const atomicMethods: Partial<ForgeAdapter> =
    atomic === undefined
      ? {}
      : {
          atomicCommitSupport: async () => atomic.support,
          enableAtomicCommits: async () => {
            atomic.support = atomic.enableResult;
            return atomic.support;
          },
        };
  const adapter: ForgeAdapter = {
    ...atomicMethods,
    limits: fake.limits,
    commitCost: (changes, costOptions) => {
      costs.push({ atomic: costOptions?.atomic === true });
      return fake.commitCost(changes);
    },
    inspect: () => fake.inspect(),
    initialize: (configText, message) => fake.initialize(configText, message),
    getHead: () => fake.getHead(),
    listTree: (sha) => fake.listTree(sha),
    readBlob: (sha) => fake.readBlob(sha),
    commit: async (request) => {
      commits.push(request);
      if (request.atomic === true && atomic?.support.kind === "needsSetup") {
        throw new ForgeError("Forbidden");
      }
      return fake.commit(request);
    },
  };
  const engine = createSyncEngine({
    adapter,
    keyring,
    clock,
    rateBudget: options?.budget?.(clock),
  });
  await engine.refresh();
  return { fake, costs, clock, engine, commits, start: await fake.getHead() };
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

async function mainTree(fake: FakeForgeAdapter): Promise<NoteTree> {
  return buildNoteTree(await fake.listTree(await fake.getHead()), keyring);
}

async function mainContent(
  fake: FakeForgeAdapter,
  path: NotePath,
): Promise<string | undefined> {
  const node = findNode(await mainTree(fake), path);
  if (node?.kind !== "note") return undefined;
  return decryptNote(keyring, await fake.readBlob(node.blobSha));
}

async function pushRemote(
  fake: FakeForgeAdapter,
  changeSet: ChangeSet,
): Promise<string> {
  const listing = await fake.listTree(await fake.getHead());
  const order = await readOrderIndex(listing, keyring, (sha) =>
    fake.readBlob(sha),
  );
  const encoded = await encodeChangeSet({ listing, changeSet, order, keyring });
  return fake.pushFromAnotherDevice(encoded.changes, encoded.message);
}

const ENTRIES: readonly ArchiveImportEntry[] = [
  { kind: "note", path: ["Imported", "First"], content: "first body" },
  {
    kind: "note",
    path: ["Imported", "Inner", "Second"],
    content: "second body",
  },
  { kind: "folder", path: ["Imported", "Empty"] },
  { kind: "note", path: ["Loose"], content: "loose body" },
];

function rootImport(engine: SyncEngine): ChangeSet {
  const plan = planImport(
    engine.getState().workingTree!,
    { kind: "root" },
    ENTRIES,
    "stop",
  );
  if (!plan.ok) throw new Error("expected a plan without conflicts");
  return plan.changes;
}

function fullBudget(clock: ReturnType<typeof createTestClock>): RateBudget {
  const budget = createRateBudget(clock, GITHUB_WRITE_LIMITS);
  for (let index = 0; index < GITHUB_WRITE_LIMITS.perMinute; index++) {
    budget.record();
  }
  return budget;
}

describe("sync engine import", () => {
  it("commits the whole import as one atomic commit right away", async () => {
    const h = await setup();
    const seen: boolean[] = [];
    h.engine.subscribe((state) => seen.push(state.importing));

    expect(await h.engine.importChanges(rootImport(h.engine))).toEqual({
      ok: true,
    });
    expect(h.engine.getState().importing).toBe(true);
    await settle(h.engine);

    expect(h.commits).toHaveLength(1);
    expect(h.commits[0].atomic).toBe(true);
    expect(h.costs).toEqual([{ atomic: true }]);
    expect(okCommitCount(h.fake, h.start)).toBe(1);
    expect(await mainContent(h.fake, ["Imported", "First"])).toBe("first body");
    expect(await mainContent(h.fake, ["Imported", "Inner", "Second"])).toBe(
      "second body",
    );
    expect(await mainContent(h.fake, ["Loose"])).toBe("loose body");
    expect(findNode(await mainTree(h.fake), ["Imported", "Empty"])?.kind).toBe(
      "folder",
    );
    const state = h.engine.getState();
    expect(state.importing).toBe(false);
    expect(state.pending).toEqual([]);
    expect(state.inFlight).toEqual([]);
    expect(seen).toContain(true);
  });

  it("saves pending edits in their own commit before the import", async () => {
    const h = await setup();
    h.engine.editNote(WELCOME, "edited before import");
    const changes = rootImport(h.engine);

    expect(await h.engine.importChanges(changes)).toEqual({ ok: true });
    await settle(h.engine);

    expect(okCommitCount(h.fake, h.start)).toBe(2);
    expect(h.commits).toHaveLength(2);
    expect(h.commits[0].atomic).toBeUndefined();
    expect(h.costs[0]).toEqual({ atomic: false });
    expect(h.commits[0].changes).toHaveLength(1);
    expect(h.commits[1].atomic).toBe(true);
    expect(await mainContent(h.fake, WELCOME)).toBe("edited before import");
    expect(await mainContent(h.fake, ["Loose"])).toBe("loose body");
  });

  it("refuses to import while earlier edits can't be saved", async () => {
    const h = await setup();
    h.fake.failNext("commit", new ForgeError("Network"));
    h.engine.editNote(WELCOME, "unsaved edit");

    expect(await h.engine.importChanges(rootImport(h.engine))).toEqual({
      ok: false,
      reason: "unsaved",
    });
    const state = h.engine.getState();
    expect(state.importing).toBe(false);
    expect(state.pending).toEqual([
      { kind: "update-note", path: WELCOME, content: "unsaved edit" },
    ]);
  });

  it("refuses changes that no longer apply to the working tree", async () => {
    const h = await setup();
    const changes = rootImport(h.engine);
    expect(h.engine.createFolder([], "Imported").ok).toBe(true);
    await settle(h.engine);

    expect(await h.engine.importChanges(changes)).toEqual({
      ok: false,
      reason: "outdated",
    });
    expect(h.engine.getState().pending).toEqual([]);
    expect(h.commits).toHaveLength(1);
  });

  it("merges with a newer remote head without losing imported content", async () => {
    const h = await setup();
    const changes = rootImport(h.engine);
    await pushRemote(h.fake, [
      { kind: "create-folder", path: ["Loose"] },
      { kind: "create-folder", path: ["Imported"] },
      { kind: "create-note", path: ["Imported", "First"], content: "remote body" },
    ]);

    expect(await h.engine.importChanges(changes)).toEqual({ ok: true });
    await settle(h.engine);

    expect(h.commits).toHaveLength(2);
    expect(h.commits.every((commit) => commit.atomic === true)).toBe(true);
    expect(okCommitCount(h.fake, h.start)).toBe(2);
    expect(await mainContent(h.fake, ["Loose (conflict)"])).toBe("loose body");
    expect(await mainContent(h.fake, ["Imported", "Inner", "Second"])).toBe(
      "second body",
    );
    expect(await mainContent(h.fake, ["Imported", "First"])).toBe("remote body");
    const state = h.engine.getState();
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts[0]).toMatchObject({
      path: ["Imported", "First"],
      mine: "first body",
      theirs: "remote body",
    });
    expect(state.importing).toBe(false);
  });

  it("retries a rate-limited import commit after the back-off", async () => {
    const h = await setup();
    h.fake.failNext(
      "commit",
      new ForgeError("RateLimited", { retryAfterMs: 0 }),
    );

    expect(await h.engine.importChanges(rootImport(h.engine))).toEqual({
      ok: true,
    });
    await settle(h.engine);
    expect(h.engine.getState().save).toMatchObject({
      kind: "waiting",
      reason: "failed",
    });
    expect(h.engine.getState().importing).toBe(true);

    await advance(h, 60_000);
    expect(h.commits).toHaveLength(2);
    expect(h.commits[1].atomic).toBe(true);
    expect(okCommitCount(h.fake, h.start)).toBe(1);
    expect(await mainContent(h.fake, ["Loose"])).toBe("loose body");
    expect(h.engine.getState().importing).toBe(false);
  });

  it("waits for the rate budget and commits edits made meanwhile with the import", async () => {
    const h = await setup({ budget: fullBudget });

    expect(await h.engine.importChanges(rootImport(h.engine))).toEqual({
      ok: true,
    });
    await settle(h.engine);
    expect(h.commits).toHaveLength(0);
    expect(h.engine.getState().save).toMatchObject({
      kind: "waiting",
      reason: "rateBudget",
    });

    h.engine.editNote(WELCOME, "edited while waiting");
    await advance(h, 60_000);

    expect(h.commits).toHaveLength(1);
    expect(h.commits[0].atomic).toBe(true);
    expect(okCommitCount(h.fake, h.start)).toBe(1);
    expect(await mainContent(h.fake, WELCOME)).toBe("edited while waiting");
    expect(await mainContent(h.fake, ["Loose"])).toBe("loose body");
  });

  it("does nothing once syncing stopped for a key change", async () => {
    const h = await setup();
    const changes = rootImport(h.engine);
    await h.fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: REPO_CONFIG_PATH, text: rekeyedConfigText },
    ]);
    await h.engine.refresh();
    expect(h.engine.getState().stopped).toEqual({ kind: "keyChanged" });

    expect(await h.engine.importChanges(changes)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(h.commits).toHaveLength(0);
  });
});

describe("sync engine import when atomic commits need setup", () => {
  const needsSetup = (canConfigure: boolean): AtomicSetup => ({
    support: { kind: "needsSetup", canConfigure },
    enableResult: { kind: "available" },
  });

  it("reports the forge's atomic commit support, available when the adapter has none", async () => {
    expect(await (await setup()).engine.atomicCommitSupport()).toEqual({
      kind: "available",
    });
    const h = await setup({ atomic: needsSetup(false) });
    expect(await h.engine.atomicCommitSupport()).toEqual({
      kind: "needsSetup",
      canConfigure: false,
    });
  });

  it("keeps a refused import pending without retrying, then saves it once enabled", async () => {
    const h = await setup({ atomic: needsSetup(true) });

    expect(await h.engine.importChanges(rootImport(h.engine))).toEqual({
      ok: true,
    });
    await settle(h.engine);
    let state = h.engine.getState();
    expect(state.atomicBlocked).toEqual({ canConfigure: true });
    expect(state.save).toEqual({
      kind: "waiting",
      reason: "failed",
      retryAt: null,
      error: { kind: "forbidden" },
    });
    expect(state.importing).toBe(true);
    expect(state.pending.length).toBeGreaterThan(0);
    expect(state.inFlight).toEqual([]);

    await advance(h, 600_000);
    expect(h.commits).toHaveLength(1);

    expect(await h.engine.enableAtomicCommits()).toEqual({ kind: "available" });
    await settle(h.engine);
    state = h.engine.getState();
    expect(h.commits).toHaveLength(2);
    expect(h.commits[1].atomic).toBe(true);
    expect(okCommitCount(h.fake, h.start)).toBe(1);
    expect(state.atomicBlocked).toBeNull();
    expect(state.importing).toBe(false);
    expect(state.save).toEqual({ kind: "idle" });
    expect(await mainContent(h.fake, ["Loose"])).toBe("loose body");
  });

  it("stays blocked when enabling is not possible", async () => {
    const h = await setup({
      atomic: {
        support: { kind: "needsSetup", canConfigure: false },
        enableResult: { kind: "needsSetup", canConfigure: false },
      },
    });
    await h.engine.importChanges(rootImport(h.engine));
    await settle(h.engine);

    expect(await h.engine.enableAtomicCommits()).toEqual({
      kind: "needsSetup",
      canConfigure: false,
    });
    await settle(h.engine);
    expect(h.commits).toHaveLength(1);
    expect(h.engine.getState().atomicBlocked).toEqual({ canConfigure: false });
  });

  it("saves a blocked import and later edits without the atomic flag when asked", async () => {
    const h = await setup({ atomic: needsSetup(false) });
    await h.engine.importChanges(rootImport(h.engine));
    await settle(h.engine);
    h.engine.editNote(WELCOME, "edited while blocked");

    h.engine.saveImportWithoutAtomic();
    await settle(h.engine);

    expect(h.commits).toHaveLength(2);
    expect(h.commits[1].atomic).toBeUndefined();
    expect(h.costs.at(-1)).toEqual({ atomic: false });
    expect(okCommitCount(h.fake, h.start)).toBe(1);
    expect(await mainContent(h.fake, ["Loose"])).toBe("loose body");
    expect(await mainContent(h.fake, WELCOME)).toBe("edited while blocked");
    const state = h.engine.getState();
    expect(state.atomicBlocked).toBeNull();
    expect(state.importing).toBe(false);

  });

  it("treats a Forbidden import commit as an ordinary failure when atomic commits are available", async () => {
    const h = await setup();
    h.fake.failNext("commit", new ForgeError("Forbidden"));
    await h.engine.importChanges(rootImport(h.engine));
    await settle(h.engine);

    const state = h.engine.getState();
    expect(state.atomicBlocked).toBeNull();
    expect(state.save).toMatchObject({
      kind: "waiting",
      reason: "failed",
      error: { kind: "forbidden" },
    });
    expect(h.engine.getState().save).toMatchObject({
      retryAt: expect.any(Number),
    });
  });
});
