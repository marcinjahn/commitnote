import { beforeAll, describe, expect, it } from "vitest";
import { argon2idDirect } from "../crypto/argon2";
import {
  createRepoConfig,
  deriveKeyring,
  type Keyring,
} from "../crypto/keyring";
import {
  parseRepoConfig,
  serializeRepoConfig,
  type RepoConfig,
} from "../crypto/repo-config";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import type { CommitRequest, ForgeAdapter } from "../forge/forge-adapter";
import { REPO_CONFIG_PATH, TRAILER } from "../format/v1";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../testing/sample-notes-repo/sample-source";
import { createSyncEngine, type SyncEngine } from "./sync-engine";
import { createTestClock } from "./testing/test-clock";

const WELCOME = ["Welcome"];

let keyring: Keyring;
let sampleConfig: RepoConfig;

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
  sampleConfig = parsed.config;
  keyring = await deriveKeyring(
    SAMPLE_NOTES_REPO_PASSPHRASE,
    parsed.config.kdf,
    argon2idDirect,
  );
});

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly engine: SyncEngine;
  readonly commits: CommitRequest[];
  readonly blobReads: string[];
  gateCommits(): () => void;
}

async function setup(engineKeyring = keyring): Promise<Harness> {
  const fake = await createSampleNotesRepoAdapter();
  const commits: CommitRequest[] = [];
  const blobReads: string[] = [];
  const gate: { current: Promise<void> | null } = { current: null };
  const adapter: ForgeAdapter = {
    limits: fake.limits,
    commitCost: (changes) => fake.commitCost(changes),
    inspect: () => fake.inspect(),
    initialize: (configText, message) => fake.initialize(configText, message),
    getHead: () => fake.getHead(),
    listTree: (sha) => fake.listTree(sha),
    listCommits: (request) => fake.listCommits(request),
    readFileAt: (sha, path) => fake.readFileAt(sha, path),
    readBlob: (sha) => {
      blobReads.push(sha);
      return fake.readBlob(sha);
    },
    commit: async (request) => {
      commits.push(request);
      if (gate.current !== null) await gate.current;
      return fake.commit(request);
    },
  };
  const engine = createSyncEngine({
    adapter,
    keyring: engineKeyring,
    clock: createTestClock(1_000_000),
  });
  await engine.refresh();
  return {
    fake,
    engine,
    commits,
    blobReads,
    gateCommits() {
      let release!: () => void;
      gate.current = new Promise((resolve) => {
        release = () => {
          gate.current = null;
          resolve();
        };
      });
      return release;
    },
  };
}

function pushSettings(fake: FakeForgeAdapter, settings: unknown) {
  return fake.pushFromAnotherDevice([
    {
      kind: "upsert-text",
      path: REPO_CONFIG_PATH,
      text: serializeRepoConfig({ ...sampleConfig, settings }),
    },
  ]);
}

async function storedConfig(fake: FakeForgeAdapter): Promise<RepoConfig> {
  const file = await fake.readFileAt(await fake.getHead(), REPO_CONFIG_PATH);
  const parsed = parseRepoConfig(file?.text ?? "");
  if (parsed.kind !== "valid") throw new Error("expected a valid config");
  return parsed.config;
}

async function configSha(fake: FakeForgeAdapter): Promise<string> {
  const listing = await fake.listTree(await fake.getHead());
  const entry = listing.find((item) => item.path === REPO_CONFIG_PATH);
  if (entry === undefined) throw new Error("expected a repo config");
  return entry.sha;
}

function settingsTrailers(message: string): string[] {
  return message
    .split("\n")
    .filter((line) => line.startsWith(`${TRAILER.settings}: `));
}

function writesConfig(request: CommitRequest): boolean {
  return request.changes.some((change) => change.path === REPO_CONFIG_PATH);
}

describe("sync engine settings", () => {
  it("saves a settings edit as one commit that rewrites only the settings of config.json", async () => {
    const h = await setup();

    h.engine.changeSettings({ accent: "teal-secret-value" });
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(h.commits).toHaveLength(1);
    const [commit] = h.commits;
    expect(commit.changes.map((change) => change.path)).toEqual([
      REPO_CONFIG_PATH,
    ]);
    expect(settingsTrailers(commit.message)).toEqual([
      `${TRAILER.settings}: accent`,
    ]);
    expect(commit.message).not.toContain("teal-secret-value");
    expect(await storedConfig(h.fake)).toEqual({
      ...sampleConfig,
      settings: { accent: "teal-secret-value" },
    });
  });

  it("combines settings edits made while another save is in flight into one commit, the latest value winning", async () => {
    const h = await setup();
    const release = h.gateCommits();
    h.engine.editNote(WELCOME, "edited before the settings");
    void h.engine.flush();

    h.engine.changeSettings({ accent: "red" });
    h.engine.changeSettings({ accent: "blue", density: 2 });
    h.engine.changeSettings({ accent: "green" });
    release();
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    const configCommits = h.commits.filter(writesConfig);
    expect(configCommits).toHaveLength(1);
    expect(settingsTrailers(configCommits[0].message)).toEqual([
      `${TRAILER.settings}: accent`,
      `${TRAILER.settings}: density`,
    ]);
    expect((await storedConfig(h.fake)).settings).toEqual({
      accent: "green",
      density: 2,
    });
  });

  it("makes no commit for an edit equal to the stored value", async () => {
    const h = await setup();
    await pushSettings(h.fake, { accent: "red" });
    await h.engine.refresh();
    const head = await h.fake.getHead();

    h.engine.changeSettings({ accent: "red" });
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(h.commits).toEqual([]);
    expect(await h.fake.getHead()).toBe(head);
    const state = h.engine.getState();
    expect(state.pending).toEqual([]);
    expect(state.inFlight).toEqual([]);
    expect(state.save).toEqual({ kind: "idle" });
  });

  it("ignores an empty settings edit", async () => {
    const h = await setup();

    h.engine.changeSettings({});

    expect(h.engine.getState().pending).toEqual([]);
    expect(await h.engine.flush()).toEqual({ kind: "saved" });
    expect(h.commits).toEqual([]);
  });

  it("shows a settings edit in the working settings before its commit lands", async () => {
    const h = await setup();
    await pushSettings(h.fake, { kept: true });
    await h.engine.refresh();
    const release = h.gateCommits();

    h.engine.changeSettings({ accent: "red" });

    expect(h.engine.getState().rawSettings).toEqual({
      kept: true,
      accent: "red",
    });
    expect(h.engine.getState().synced?.config.settings).toEqual({
      kept: true,
    });
    release();
    expect(await h.engine.flush()).toEqual({ kind: "saved" });
    expect(h.engine.getState().rawSettings).toEqual({
      kept: true,
      accent: "red",
    });
  });

  it("merges an in-flight settings edit with settings committed remotely meanwhile", async () => {
    const h = await setup();
    await pushSettings(h.fake, { a: 1, b: 1 });

    h.engine.changeSettings({ b: 2, c: 2 });
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(h.commits).toHaveLength(2);
    expect((await storedConfig(h.fake)).settings).toEqual({
      a: 1,
      b: 2,
      c: 2,
    });
    expect(h.engine.getState().rawSettings).toEqual({ a: 1, b: 2, c: 2 });
  });

  it("keeps unknown stored settings when editing another key", async () => {
    const h = await setup();
    await pushSettings(h.fake, { fromNewerVersion: { nested: [1, 2] } });
    await h.engine.refresh();

    h.engine.changeSettings({ accent: "red" });
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect((await storedConfig(h.fake)).settings).toEqual({
      fromNewerVersion: { nested: [1, 2] },
      accent: "red",
    });
  });

  it("adopts remote settings changes on refresh and keeps saving", async () => {
    const h = await setup();
    await pushSettings(h.fake, { accent: "red" });

    await h.engine.refresh();

    const state = h.engine.getState();
    expect(state.stopped).toBeNull();
    expect(state.synced?.config.settings).toEqual({ accent: "red" });
    expect(state.synced?.settings).toEqual({});
    expect(state.rawSettings).toEqual({ accent: "red" });

    await pushSettings(h.fake, { accent: "blue" });
    await h.engine.refresh();
    expect(h.engine.getState().rawSettings).toEqual({ accent: "blue" });

    h.engine.editNote(WELCOME, "saved after remote settings");
    h.engine.changeSettings({ density: 1 });
    expect(await h.engine.flush()).toEqual({ kind: "saved" });
    expect(h.engine.getState().stopped).toBeNull();
    expect((await storedConfig(h.fake)).settings).toEqual({
      accent: "blue",
      density: 1,
    });
  });

  it("reads config.json only once while its blob is unchanged", async () => {
    const h = await setup();
    const sha = await configSha(h.fake);
    expect(h.blobReads.filter((read) => read === sha)).toHaveLength(1);

    h.engine.editNote(WELCOME, "a new commit");
    expect(await h.engine.flush()).toEqual({ kind: "saved" });
    await h.fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: "unrelated.txt", text: "x" },
    ]);
    await h.engine.refresh();

    expect(await configSha(h.fake)).toBe(sha);
    expect(h.blobReads.filter((read) => read === sha)).toHaveLength(1);
  });

  it("stops for a key change when config.json no longer verifies against the key", async () => {
    const h = await setup();
    const rekeyed = await createRepoConfig("another passphrase", {
      argon2id: argon2idDirect,
      kdf: sampleConfig.kdf,
    });
    await h.fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: REPO_CONFIG_PATH, text: rekeyed.configText },
    ]);

    await h.engine.refresh();

    expect(h.engine.getState().stopped).toEqual({ kind: "keyChanged" });
    h.engine.changeSettings({ accent: "red" });
    expect(await h.engine.flush()).toEqual({ kind: "unsaved", count: 1 });
    expect(h.commits).toEqual([]);
  });
});
