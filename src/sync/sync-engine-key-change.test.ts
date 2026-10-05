import { beforeAll, describe, expect, it } from "vitest";
import { sharedMemoizedArgon2id } from "../crypto/testing/shared-argon2id";
import { sampleNotesRepoKeyring, sampleNotesRepoConfig } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import {
  createRepoConfig,
  type Keyring,
} from "../crypto/keyring";
import { decryptNote } from "../crypto/note-cipher";
import {
  serializeRepoConfig,
  type RepoConfig,
} from "../crypto/repo-config";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import type { CommitRequest, ForgeAdapter } from "../forge/forge-adapter";
import { REPO_CONFIG_PATH } from "../format/v1";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { buildNoteTree, findNode } from "../tree/note-tree";
import { createTestClock } from "./testing/test-clock";
import { createSyncEngine, type SyncEngine } from "./sync-engine";

const WELCOME = ["Welcome"];

let keyring: Keyring;
let sampleConfig: RepoConfig;
let rekeyedConfigText: string;

beforeAll(async () => {
  sampleConfig = sampleNotesRepoConfig();
  keyring = await sampleNotesRepoKeyring();
  rekeyedConfigText = (
    await createRepoConfig("another passphrase", {
      argon2id: sharedMemoizedArgon2id,
      kdf: sampleNotesRepoConfig().kdf,
    })
  ).configText;
});

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly engine: SyncEngine;
  readonly commits: CommitRequest[];
  readonly blobReads: string[];
}

async function setup(engineKeyring = keyring): Promise<Harness> {
  const fake = await createSampleNotesRepoAdapter();
  const commits: CommitRequest[] = [];
  const blobReads: string[] = [];
  const adapter: ForgeAdapter = {
    limits: fake.limits,
    commitCost: (changes) => fake.commitCost(changes),
    inspect: () => fake.inspect(),
    initialize: (configText, message) => fake.initialize(configText, message),
    getHead: () => fake.getHead(),
    listTree: (sha) => fake.listTree(sha),
    listCommits: (request) => fake.listCommits(request),
    findOldestCommit: (request) => fake.findOldestCommit(request),
    readFileAt: (sha, path) => fake.readFileAt(sha, path),
    readBlob: (sha) => {
      blobReads.push(sha);
      return fake.readBlob(sha);
    },
    commit: (request) => {
      commits.push(request);
      return fake.commit(request);
    },
  };
  const clock = createTestClock(1_000_000);
  const engine = createSyncEngine({ adapter, keyring: engineKeyring, clock });
  await engine.refresh();
  return { fake, clock, engine, commits, blobReads };
}

function pushConfig(fake: FakeForgeAdapter, text: string): Promise<string> {
  return fake.pushFromAnotherDevice([
    { kind: "upsert-text", path: REPO_CONFIG_PATH, text },
  ]);
}

async function configSha(fake: FakeForgeAdapter): Promise<string> {
  const listing = await fake.listTree(await fake.getHead());
  const entry = listing.find((item) => item.path === REPO_CONFIG_PATH);
  if (entry === undefined) throw new Error("expected a repo config");
  return entry.sha;
}

async function welcomeText(fake: FakeForgeAdapter): Promise<string> {
  const tree = await buildNoteTree(
    await fake.listTree(await fake.getHead()),
    keyring,
  );
  const node = findNode(tree, WELCOME);
  if (node?.kind !== "note") throw new Error("expected Welcome");
  return decryptNote(keyring, await fake.readBlob(node.blobSha));
}

function expectStoppedForKeyChange(h: Harness, syncedHead: string): void {
  const state = h.engine.getState();
  expect(state.stopped).toEqual({ kind: "keyChanged" });
  expect(state.save).toEqual({
    kind: "waiting",
    reason: "failed",
    retryAt: null,
    error: { kind: "keyChanged" },
  });
  expect(state.synced?.head).toBe(syncedHead);
}

async function expectStaysStopped(h: Harness): Promise<void> {
  const commitCount = h.commits.length;
  const head = await h.fake.getHead();
  h.engine.editNote(WELCOME, "typed after the stop");
  h.clock.advance(10 * 60_000);
  h.engine.retryNow();
  await h.engine.refresh();
  expect(await h.engine.flush()).toEqual({ kind: "unsaved", count: 1 });
  expect(h.commits).toHaveLength(commitCount);
  expect(await h.fake.getHead()).toBe(head);
  expect(h.engine.getState().stopped).toEqual({ kind: "keyChanged" });
}

describe("sync engine key-change guard", () => {
  it("stops on the first load when the keyring does not match the repo config", async () => {
    const other = await createRepoConfig("unrelated", {
      argon2id: sharedMemoizedArgon2id,
      kdf: sampleConfig.kdf,
    });
    const h = await setup(other.keyring);

    const state = h.engine.getState();
    expect(state.stopped).toEqual({ kind: "keyChanged" });
    expect(state.refresh.lastError).toEqual({ kind: "keyChanged" });
    expect(state.synced).toBeNull();
  });

  it("keeps a pending edit and never commits when the stale-retry merge meets a re-keyed head", async () => {
    const h = await setup();
    const verifiedHead = h.engine.getState().synced!.head;
    const rekeyedHead = await pushConfig(h.fake, rekeyedConfigText);

    h.engine.editNote(WELCOME, "edited with the old key");
    expect(await h.engine.flush()).toEqual({ kind: "unsaved", count: 1 });

    expect(h.commits).toHaveLength(1);
    expect(h.commits[0].parent).toBe(verifiedHead);
    expect(await h.fake.getHead()).toBe(rekeyedHead);
    expectStoppedForKeyChange(h, verifiedHead);
    const state = h.engine.getState();
    expect(state.inFlight).toEqual([]);
    expect(state.pending).toEqual([
      {
        kind: "update-note",
        path: WELCOME,
        content: "edited with the old key",
      },
    ]);
    await expectStaysStopped(h);
  });

  it("stops on refresh without local changes and keeps showing the verified tree", async () => {
    const h = await setup();
    const verifiedHead = h.engine.getState().synced!.head;
    await pushConfig(h.fake, rekeyedConfigText);

    await h.engine.refresh();

    expectStoppedForKeyChange(h, verifiedHead);
    expect(h.engine.getState().refresh.lastError).toEqual({
      kind: "keyChanged",
    });
    expect(
      h.engine.getState().workingTree?.root.children.map((child) => child.name),
    ).toContain("Welcome");
    expect(h.commits).toEqual([]);
    await expectStaysStopped(h);
  });

  it("stops when a refresh with a pending edit leads to a re-keyed head", async () => {
    const h = await setup();
    const verifiedHead = h.engine.getState().synced!.head;
    const rekeyedHead = await pushConfig(h.fake, rekeyedConfigText);
    h.engine.editNote(WELCOME, "pending during refresh");

    await h.engine.refresh();
    await expect
      .poll(() => h.engine.getState().stopped)
      .toEqual({ kind: "keyChanged" });

    expectStoppedForKeyChange(h, verifiedHead);
    expect(await h.fake.getHead()).toBe(rekeyedHead);
    expect(h.engine.getState().pending).toHaveLength(1);
    await expectStaysStopped(h);
  });

  it("stops when the repo config is removed", async () => {
    const h = await setup();
    const verifiedHead = h.engine.getState().synced!.head;
    await h.fake.pushFromAnotherDevice([
      { kind: "delete", path: REPO_CONFIG_PATH },
    ]);

    await h.engine.refresh();

    expectStoppedForKeyChange(h, verifiedHead);
  });

  it("stops when the repo config can no longer be parsed", async () => {
    const h = await setup();
    const verifiedHead = h.engine.getState().synced!.head;
    await pushConfig(h.fake, "not json");

    await h.engine.refresh();

    expectStoppedForKeyChange(h, verifiedHead);
  });

  it("keeps saving after a config change that the key still verifies", async () => {
    const h = await setup();
    const harmless = serializeRepoConfig({
      ...sampleConfig,
      createdAt: "2030-01-01T00:00:00.000Z",
    });
    await pushConfig(h.fake, harmless);
    const changedSha = await configSha(h.fake);

    h.engine.editNote(WELCOME, "saved after a harmless change");
    expect(await h.engine.flush()).toEqual({ kind: "saved" });
    await h.engine.refresh();

    expect(h.engine.getState().stopped).toBeNull();
    expect(await welcomeText(h.fake)).toBe("saved after a harmless change");
    expect(h.blobReads.filter((sha) => sha === changedSha)).toHaveLength(1);
  });
});
