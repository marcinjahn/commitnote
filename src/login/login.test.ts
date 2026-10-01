import { beforeAll, describe, expect, it, vi } from "vitest";
import { encodeInitializeMessage } from "../changes/encode-change-set";
import { argon2idDirect } from "../crypto/argon2";
import {
  createRepoConfig,
  deriveKeyring,
  verifyKeyCheck,
} from "../crypto/keyring";
import { parseRepoConfig, type RepoConfig } from "../crypto/repo-config";
import { ForgeError } from "../forge/errors";
import type {
  ForgeProvider,
  RepositorySummary,
} from "../forge/forge-provider";
import { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { commitFiles, InMemoryGitRepo } from "../forge/fake/in-memory-git-repo";
import { APP_ID, MAIN_BRANCH, REPO_CONFIG_PATH } from "../format/v1";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import {
  README_COMMIT_MESSAGE,
  README_PATH,
  README_TEXT,
} from "./repo-readme";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../testing/sample-notes-repo/sample-source";
import {
  classifyRoot,
  initializeNotesRepo,
  inspectRepository,
  listRepositories,
  resumeSession,
  unlockNotesRepo,
  type LoginDependencies,
  type LoginResult,
  type LoginStep,
  type NotesRepoTarget,
  type PendingInitialization,
} from "./login";
import type { RootEntry } from "../forge/forge-adapter";
import type { Session } from "../session/session";

const REPO_URL = "https://github.com/alice/notes";
const REPOSITORY: RepositorySummary = {
  coordinates: { forge: "github", owner: "alice", repo: "notes" },
  url: REPO_URL,
  private: true,
};

function deps(
  adapter: FakeForgeAdapter,
  overrides: Partial<LoginDependencies> = {},
): LoginDependencies {
  return {
    createAdapter: () => adapter,
    argon2id: argon2idDirect,
    ...overrides,
  };
}

function expectLoggedIn(
  result: LoginResult,
): Extract<LoginResult, { kind: "loggedIn" }> {
  if (result.kind !== "loggedIn") {
    throw new Error(`expected loggedIn, got ${JSON.stringify(result)}`);
  }
  return result;
}

async function repoConfigOf(adapter: FakeForgeAdapter): Promise<RepoConfig> {
  const inspection = await adapter.inspect();
  if (
    inspection.kind !== "populated" ||
    inspection.main === null ||
    inspection.main.repoConfigText === null
  ) {
    throw new Error("expected a populated repo with a repo config");
  }
  const parsed = parseRepoConfig(inspection.main.repoConfigText);
  if (parsed.kind !== "valid") {
    throw new Error(`expected a valid repo config, got ${parsed.kind}`);
  }
  return parsed.config;
}

async function inspectAndUnlock(
  adapter: FakeForgeAdapter,
  passphrase: string,
  onStep?: (step: LoginStep) => void,
): Promise<LoginResult> {
  const state = await inspectRepository(
    REPOSITORY,
    "  token  ",
    deps(adapter),
    onStep,
  );
  if (state.kind !== "notesRepo") {
    throw new Error(`expected notesRepo, got ${JSON.stringify(state)}`);
  }
  return unlockNotesRepo(state.target, passphrase, deps(adapter), onStep);
}

async function inspectState(adapter: FakeForgeAdapter) {
  return inspectRepository(REPOSITORY, "token", deps(adapter));
}

async function almostEmptyAdapter(
  files: Record<string, string>,
): Promise<{ adapter: FakeForgeAdapter; head: string }> {
  const repo = new InMemoryGitRepo();
  const head = await commitFiles(repo, {
    parent: null,
    files,
    message: "Initial commit",
    branch: MAIN_BRANCH,
  });
  return { adapter: new FakeForgeAdapter({ repo }), head };
}

async function inspectUninitialized(
  adapter: FakeForgeAdapter,
): Promise<PendingInitialization> {
  const state = await inspectRepository(REPOSITORY, "token", deps(adapter));
  if (state.kind !== "uninitialized") {
    throw new Error(`expected uninitialized, got ${state.kind}`);
  }
  return state.pending;
}

async function blobShasAt(
  adapter: FakeForgeAdapter,
  head: string,
): Promise<Record<string, string>> {
  const entries = await adapter.listTree(head);
  return Object.fromEntries(
    entries
      .filter((entry) => entry.type === "blob")
      .map((entry) => [entry.path, entry.sha]),
  );
}

describe("inspecting and unlocking", () => {
  it("logs in to the sample notes repo with its passphrase", async () => {
    const adapter = await createSampleNotesRepoAdapter();
    const steps: LoginStep[] = [];

    const result = await inspectAndUnlock(
      adapter,
      SAMPLE_NOTES_REPO_PASSPHRASE,
      (step) => steps.push(step),
    );

    const loggedIn = expectLoggedIn(result);
    expect(loggedIn.adapter).toBe(adapter);
    expect(loggedIn.session.repoUrl).toBe(REPO_URL);
    expect(loggedIn.session.accessToken).toBe("token");
    expect(steps).toEqual(["checkingRepository", "derivingKeys"]);

    const config = await repoConfigOf(adapter);
    expect(await verifyKeyCheck(loggedIn.session.keyring, config)).toBe(true);
  });

  it("fails with wrongPassphrase for the wrong passphrase", async () => {
    const adapter = await createSampleNotesRepoAdapter();

    const result = await inspectAndUnlock(adapter, "wrong one");

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "wrongPassphrase" },
    });
  });

  it.each([
    ["Unauthorized", new ForgeError("Unauthorized"), { kind: "unauthorized" }],
    ["NotFound", new ForgeError("NotFound"), { kind: "noAccess" }],
    ["Forbidden", new ForgeError("Forbidden"), { kind: "noAccess" }],
    [
      "RateLimited",
      new ForgeError("RateLimited", { retryAfterMs: 120_000 }),
      { kind: "rateLimited", retryAfterMs: 120_000 },
    ],
    ["Network", new ForgeError("Network"), { kind: "network" }],
    ["Server", new ForgeError("Server"), { kind: "server" }],
  ])("maps a %s inspect failure", async (_label, forgeError, error) => {
    const adapter = new FakeForgeAdapter();
    adapter.failNext("inspect", forgeError);

    expect(await inspectState(adapter)).toEqual({ kind: "unusable", error });
  });

  it("rejects a read-only access token for a populated repo, before deriving keys", async () => {
    const adapter = await createSampleNotesRepoAdapter({ canWrite: false });

    expect(await inspectState(adapter)).toEqual({
      kind: "unusable",
      error: { kind: "readOnly" },
    });
  });

  it("rejects a read-only access token for an empty repo", async () => {
    const adapter = new FakeForgeAdapter({ canWrite: false });

    expect(await inspectState(adapter)).toEqual({
      kind: "unusable",
      error: { kind: "readOnly" },
    });
  });

  it("reports a populated repo whose main branch is missing as noMainBranch, writing nothing", async () => {
    const repo = new InMemoryGitRepo();
    const otherHead = await commitFiles(repo, {
      parent: null,
      files: { "note.txt": "hello" },
      message: "commit to another branch",
      branch: "other",
    });
    const adapter = new FakeForgeAdapter({ repo });

    expect(await inspectState(adapter)).toEqual({
      kind: "unusable",
      error: { kind: "noMainBranch" },
    });
    expect(repo.getRef("other")).toBe(otherHead);
    expect(repo.getRef(MAIN_BRANCH)).toBeUndefined();
  });

  it("treats a populated main branch without a repo config as foreign, writing nothing", async () => {
    const repo = new InMemoryGitRepo();
    const head = await commitFiles(repo, {
      parent: null,
      files: { "note.txt": "hello" },
      message: "no config",
      branch: MAIN_BRANCH,
    });
    const adapter = new FakeForgeAdapter({ repo });

    expect(await inspectState(adapter)).toEqual({
      kind: "unusable",
      error: { kind: "foreign" },
    });
    expect(repo.getRef(MAIN_BRANCH)).toBe(head);
  });

  it("treats an invalid repo config as foreign, writing nothing", async () => {
    const repo = new InMemoryGitRepo();
    const head = await commitFiles(repo, {
      parent: null,
      files: { [REPO_CONFIG_PATH]: "not json" },
      message: "bad config",
      branch: MAIN_BRANCH,
    });
    const adapter = new FakeForgeAdapter({ repo });

    expect(await inspectState(adapter)).toEqual({
      kind: "unusable",
      error: { kind: "foreign" },
    });
    expect(repo.getRef(MAIN_BRANCH)).toBe(head);
  });

  it("reports newerFormat with the config's format version", async () => {
    const repo = new InMemoryGitRepo();
    const head = await commitFiles(repo, {
      parent: null,
      files: {
        [REPO_CONFIG_PATH]: JSON.stringify({ app: APP_ID, formatVersion: 2 }),
      },
      message: "newer format",
      branch: MAIN_BRANCH,
    });
    const adapter = new FakeForgeAdapter({ repo });

    expect(await inspectState(adapter)).toEqual({
      kind: "unusable",
      error: { kind: "newerFormat", formatVersion: 2 },
    });
    expect(repo.getRef(MAIN_BRANCH)).toBe(head);
  });

  it("initializes an empty repository end-to-end, after which the same passphrase logs in and a wrong one does not", async () => {
    const adapter = new FakeForgeAdapter({ defaultBranch: "master" });
    const passphrase = "a fresh passphrase";

    const pending = await inspectUninitialized(adapter);
    expect(adapter.repo.hasCommits()).toBe(false);

    const steps: LoginStep[] = [];
    const initResult = await initializeNotesRepo(
      pending,
      passphrase,
      deps(adapter),
      (step) => steps.push(step),
    );
    expectLoggedIn(initResult);
    expect(steps).toEqual(["derivingKeys", "initializing"]);

    const head = adapter.repo.getRef(MAIN_BRANCH);
    expect(head).toBeDefined();
    const commit = adapter.repo.getCommit(head as string);
    expect(commit?.message).toBe(README_COMMIT_MESSAGE);
    expect(adapter.repo.getCommit(commit?.parent as string)?.message).toBe(
      encodeInitializeMessage(),
    );

    const entries = await adapter.listTree(head as string);
    const fileEntries = entries.filter((entry) => entry.type === "blob");
    expect(fileEntries.map((entry) => entry.path).sort()).toEqual(
      [REPO_CONFIG_PATH, README_PATH].sort(),
    );

    const configEntry = fileEntries.find(
      (entry) => entry.path === REPO_CONFIG_PATH,
    );
    const readmeEntry = fileEntries.find((entry) => entry.path === README_PATH);
    const configText = await adapter.readBlob(configEntry?.sha as string);
    expect(parseRepoConfig(configText).kind).toBe("valid");
    expect(await adapter.readBlob(readmeEntry?.sha as string)).toBe(
      README_TEXT,
    );

    expectLoggedIn(await inspectAndUnlock(adapter, passphrase));

    const wrongLogin = await inspectAndUnlock(adapter, "another one");
    expect(wrongLogin).toEqual({
      kind: "failed",
      error: { kind: "wrongPassphrase" },
    });
  });

  it("reports initializationRaced when initialize comes back stale", async () => {
    const adapter = new FakeForgeAdapter();
    const passphrase = "a passphrase";

    const pending = await inspectUninitialized(adapter);

    adapter.failNext("initialize", "stale");
    const result = await initializeNotesRepo(
      pending,
      passphrase,
      deps(adapter),
    );

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "initializationRaced" },
    });
  });
  it("reports server when initializing an empty repository fails with Server", async () => {
    const adapter = new FakeForgeAdapter();
    const pending = await inspectUninitialized(adapter);
    adapter.failNext("initialize", new ForgeError("Server"));

    const result = await initializeNotesRepo(pending, "pass", deps(adapter));

    expect(result).toEqual({ kind: "failed", error: { kind: "server" } });
  });
});

describe("classifyRoot", () => {
  const blob = (name: string): RootEntry => ({ name, type: "blob" });

  it.each([
    [[], { kind: "almostEmpty", hasReadme: false }],
    [[blob("README.md")], { kind: "almostEmpty", hasReadme: true }],
    [[blob("readme")], { kind: "almostEmpty", hasReadme: true }],
    [[blob("ReadMe.rst")], { kind: "almostEmpty", hasReadme: true }],
    [
      [blob("README.md"), blob("LICENSE"), blob(".gitignore")],
      { kind: "almostEmpty", hasReadme: true },
    ],
    [[blob("LICENSE.txt")], { kind: "almostEmpty", hasReadme: false }],
    [[blob("licence.md")], { kind: "almostEmpty", hasReadme: false }],
    [[blob("COPYING")], { kind: "almostEmpty", hasReadme: false }],
    [[blob(".gitignore")], { kind: "almostEmpty", hasReadme: false }],
    [[blob("README.md"), blob("index.js")], { kind: "foreign" }],
    [[blob("LICENSE.js")], { kind: "foreign" }],
    [[blob("readme-notes.md")], { kind: "foreign" }],
    [[blob(".gitattributes")], { kind: "foreign" }],
    [[{ name: "README.md", type: "tree" }], { kind: "foreign" }],
    [[blob("README.md"), { name: "docs", type: "tree" }], { kind: "foreign" }],
  ] satisfies [RootEntry[], ReturnType<typeof classifyRoot>][])(
    "classifies %j",
    (entries, expected) => {
      expect(classifyRoot(entries)).toEqual(expected);
    },
  );
});

describe("inspectRepository", () => {
  it("reports a notes repo with its parsed config, with the token trimmed", async () => {
    const adapter = await createSampleNotesRepoAdapter();
    const steps: LoginStep[] = [];

    const state = await inspectRepository(
      REPOSITORY,
      "  token  ",
      deps(adapter),
      (step) => steps.push(step),
    );

    expect(state).toEqual({
      kind: "notesRepo",
      target: {
        repoUrl: REPO_URL,
        coordinates: REPOSITORY.coordinates,
        accessToken: "token",
        adapter,
        config: await repoConfigOf(adapter),
      },
    });
    expect(steps).toEqual(["checkingRepository"]);
  });

  it("reports an empty repository as uninitialized without a base", async () => {
    const adapter = new FakeForgeAdapter();

    const pending = await inspectUninitialized(adapter);

    expect(pending).toMatchObject({ base: null, existingFiles: [] });
  });

  it("reports a repository with only README, LICENSE and .gitignore as uninitialized on its head", async () => {
    const { adapter, head } = await almostEmptyAdapter({
      "README.md": "# notes\n",
      LICENSE: "MIT",
      ".gitignore": "node_modules\n",
    });

    const pending = await inspectUninitialized(adapter);

    expect(pending.base).toEqual({ head, hasReadme: true });
    expect([...pending.existingFiles].sort()).toEqual(
      [".gitignore", "LICENSE", "README.md"].sort(),
    );
  });

  it("reports a repository with other root files as foreign", async () => {
    const { adapter } = await almostEmptyAdapter({
      "README.md": "# app\n",
      "src/index.js": "console.log(1);\n",
    });

    const state = await inspectRepository(REPOSITORY, "token", deps(adapter));

    expect(state).toEqual({ kind: "unusable", error: { kind: "foreign" } });
  });

  it("reports a read-only token for an almost-empty repo as readOnly", async () => {
    const repo = new InMemoryGitRepo();
    await commitFiles(repo, {
      parent: null,
      files: { "README.md": "# notes\n" },
      message: "Initial commit",
      branch: MAIN_BRANCH,
    });
    const adapter = new FakeForgeAdapter({ repo, canWrite: false });

    const state = await inspectRepository(REPOSITORY, "token", deps(adapter));

    expect(state).toEqual({ kind: "unusable", error: { kind: "readOnly" } });
  });
});

describe("unlockNotesRepo", () => {
  let adapter: FakeForgeAdapter;
  let target: NotesRepoTarget;

  beforeAll(async () => {
    adapter = await createSampleNotesRepoAdapter();
    const state = await inspectRepository(REPOSITORY, "token", deps(adapter));
    if (state.kind !== "notesRepo") throw new Error("expected notesRepo");
    target = state.target;
  });

  it("logs in with the right passphrase without inspecting the repository again", async () => {
    const inspect = vi.spyOn(adapter, "inspect");
    const steps: LoginStep[] = [];

    const result = await unlockNotesRepo(
      target,
      SAMPLE_NOTES_REPO_PASSPHRASE,
      deps(adapter),
      (step) => steps.push(step),
    );

    const loggedIn = expectLoggedIn(result);
    expect(loggedIn.adapter).toBe(adapter);
    expect(loggedIn.session).toMatchObject({
      repoUrl: REPO_URL,
      coordinates: REPOSITORY.coordinates,
      accessToken: "token",
    });
    expect(await verifyKeyCheck(loggedIn.session.keyring, target.config)).toBe(
      true,
    );
    expect(inspect).not.toHaveBeenCalled();
    expect(steps).toEqual(["derivingKeys"]);
    inspect.mockRestore();
  });

  it("fails with wrongPassphrase for the wrong passphrase", async () => {
    const result = await unlockNotesRepo(target, "wrong one", deps(adapter));

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "wrongPassphrase" },
    });
  });
});

describe("unlockNotesRepo after the repository changed since it was inspected", () => {
  async function inspectedTarget(
    adapter: FakeForgeAdapter,
  ): Promise<NotesRepoTarget> {
    const state = await inspectState(adapter);
    if (state.kind !== "notesRepo") throw new Error("expected notesRepo");
    return state.target;
  }

  async function changePassphraseElsewhere(
    adapter: FakeForgeAdapter,
    passphrase: string,
  ): Promise<void> {
    const { configText } = await createRepoConfig(passphrase, {
      argon2id: argon2idDirect,
    });
    const head = adapter.repo.getRef(MAIN_BRANCH) as string;
    const result = await adapter.commit({
      parent: head,
      changes: [
        { kind: "upsert-text", path: REPO_CONFIG_PATH, text: configText },
      ],
      message: "rekey",
    });
    expect(result.kind).toBe("ok");
  }

  it("logs in with a passphrase changed on another device after the inspection", async () => {
    const adapter = await createSampleNotesRepoAdapter();
    const target = await inspectedTarget(adapter);
    await changePassphraseElsewhere(adapter, "new passphrase");

    const result = await unlockNotesRepo(
      target,
      "new passphrase",
      deps(adapter),
    );

    const loggedIn = expectLoggedIn(result);
    expect(
      await verifyKeyCheck(loggedIn.session.keyring, await repoConfigOf(adapter)),
    ).toBe(true);
  });

  it("returns the re-read target with wrongPassphrase when the changed config does not match either", async () => {
    const adapter = await createSampleNotesRepoAdapter();
    const target = await inspectedTarget(adapter);
    await changePassphraseElsewhere(adapter, "new passphrase");

    const result = await unlockNotesRepo(target, "wrong one", deps(adapter));

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "wrongPassphrase" },
      target: { ...target, config: await repoConfigOf(adapter) },
    });
  });

  it("derives keys only once when the config is unchanged", async () => {
    const adapter = await createSampleNotesRepoAdapter();
    const target = await inspectedTarget(adapter);
    const argon2id = vi.fn(argon2idDirect);
    const steps: LoginStep[] = [];

    const result = await unlockNotesRepo(
      target,
      "wrong one",
      deps(adapter, { argon2id }),
      (step) => steps.push(step),
    );

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "wrongPassphrase" },
    });
    expect(argon2id).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(["derivingKeys", "checkingRepository"]);
  });

  it("still reports wrongPassphrase when re-reading the repository fails transiently", async () => {
    const adapter = await createSampleNotesRepoAdapter();
    const target = await inspectedTarget(adapter);
    adapter.failNext("inspect", new ForgeError("Network"));

    const result = await unlockNotesRepo(target, "wrong one", deps(adapter));

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "wrongPassphrase" },
    });
  });

  it("reports why the repository can no longer be used", async () => {
    const adapter = await createSampleNotesRepoAdapter();
    const target = await inspectedTarget(adapter);
    adapter.failNext("inspect", new ForgeError("NotFound"));

    const result = await unlockNotesRepo(target, "wrong one", deps(adapter));

    expect(result).toEqual({ kind: "failed", error: { kind: "noAccess" } });
  });

  it("reports repositoryChanged when the repository no longer holds a notes repo", async () => {
    const adapter = await createSampleNotesRepoAdapter();
    const target = await inspectedTarget(adapter);
    const { adapter: almostEmpty } = await almostEmptyAdapter({
      "README.md": "x",
    });

    const result = await unlockNotesRepo(
      { ...target, adapter: almostEmpty },
      "wrong one",
      deps(almostEmpty),
    );

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "repositoryChanged" },
    });
  });
});

describe("initializeNotesRepo on an almost-empty repository", () => {
  it("adds the repo config on top of the existing head, keeping its files byte-for-byte and adding no README", async () => {
    const { adapter, head } = await almostEmptyAdapter({
      "README.md": "# My notes\n",
      LICENSE: "MIT License",
      ".gitignore": ".DS_Store\n",
    });
    const before = await blobShasAt(adapter, head);
    const pending = await inspectUninitialized(adapter);
    const passphrase = "an almost-empty passphrase";

    const result = await initializeNotesRepo(pending, passphrase, deps(adapter));

    expectLoggedIn(result);
    const newHead = adapter.repo.getRef(MAIN_BRANCH) as string;
    const commit = adapter.repo.getCommit(newHead);
    expect(commit?.parent).toBe(head);
    expect(commit?.message).toBe(encodeInitializeMessage());
    const after = await blobShasAt(adapter, newHead);
    expect(Object.keys(after).sort()).toEqual(
      [...Object.keys(before), REPO_CONFIG_PATH].sort(),
    );
    for (const [path, sha] of Object.entries(before)) {
      expect(after[path]).toBe(sha);
    }
    expect(parseRepoConfig(await adapter.readBlob(after[REPO_CONFIG_PATH])).kind).toBe(
      "valid",
    );

    expectLoggedIn(await inspectAndUnlock(adapter, passphrase));
  });

  it("adds commitnote's README after the config commit when the repository has none", async () => {
    const { adapter, head } = await almostEmptyAdapter({ LICENSE: "MIT" });
    const pending = await inspectUninitialized(adapter);

    expectLoggedIn(await initializeNotesRepo(pending, "pass", deps(adapter)));

    const newHead = adapter.repo.getRef(MAIN_BRANCH) as string;
    const readmeCommit = adapter.repo.getCommit(newHead);
    expect(readmeCommit?.message).toBe(README_COMMIT_MESSAGE);
    const configCommit = adapter.repo.getCommit(readmeCommit?.parent as string);
    expect(configCommit?.message).toBe(encodeInitializeMessage());
    expect(configCommit?.parent).toBe(head);
    const files = await blobShasAt(adapter, newHead);
    expect(await adapter.readBlob(files[README_PATH])).toBe(README_TEXT);
  });

  it("reports initializationRaced when the config commit comes back stale", async () => {
    const { adapter, head } = await almostEmptyAdapter({ "README.md": "x" });
    const pending = await inspectUninitialized(adapter);
    adapter.failNext("commit", "stale");

    const result = await initializeNotesRepo(pending, "pass", deps(adapter));

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "initializationRaced" },
    });
    expect(adapter.repo.getRef(MAIN_BRANCH)).toBe(head);
  });

  it("reports initializationRaced when the config commit fails with Server, as GitLab does when main moved meanwhile", async () => {
    const { adapter } = await almostEmptyAdapter({ "README.md": "x" });
    const pending = await inspectUninitialized(adapter);
    adapter.failNext("commit", new ForgeError("Server"));

    const result = await initializeNotesRepo(pending, "pass", deps(adapter));

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "initializationRaced" },
    });
  });

  it("reports readOnly when the config commit is forbidden", async () => {
    const { adapter } = await almostEmptyAdapter({ "README.md": "x" });
    const pending = await inspectUninitialized(adapter);
    adapter.failNext("commit", new ForgeError("Forbidden"));

    const result = await initializeNotesRepo(pending, "pass", deps(adapter));

    expect(result).toEqual({ kind: "failed", error: { kind: "readOnly" } });
  });
});

describe("resumeSession", () => {
  let adapter: FakeForgeAdapter;
  let session: Session;

  beforeAll(async () => {
    adapter = await createSampleNotesRepoAdapter();
    const loginResult = await inspectAndUnlock(
      adapter,
      SAMPLE_NOTES_REPO_PASSPHRASE,
    );
    session = expectLoggedIn(loginResult).session;
  });

  it("re-verifies a remembered session without deriving keys", async () => {
    const argon2id = vi.fn();
    const steps: LoginStep[] = [];

    const result = await resumeSession(
      session,
      deps(adapter, { argon2id }),
      (step) => steps.push(step),
    );

    expect(result).toEqual({ kind: "loggedIn", session, adapter });
    expect(argon2id).not.toHaveBeenCalled();
    expect(steps).toEqual(["checkingRepository"]);
  });

  it("fails with wrongPassphrase when the session's keyring no longer matches the repo config", async () => {
    const config = await repoConfigOf(adapter);
    const wrongKeyring = await deriveKeyring(
      "a different passphrase",
      config.kdf,
      argon2idDirect,
    );
    const staleSession: Session = { ...session, keyring: wrongKeyring };

    const result = await resumeSession(staleSession, deps(adapter));

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "wrongPassphrase" },
    });
  });

  it("treats an almost-empty repository as foreign", async () => {
    const { adapter: almostEmpty } = await almostEmptyAdapter({
      "README.md": "x",
    });

    const result = await resumeSession(session, deps(almostEmpty));

    expect(result).toEqual({ kind: "failed", error: { kind: "foreign" } });
  });

  it("reports a repository without a main branch as noMainBranch", async () => {
    const repo = new InMemoryGitRepo();
    await commitFiles(repo, {
      parent: null,
      files: { "note.txt": "hello" },
      message: "commit to another branch",
      branch: "other",
    });

    const result = await resumeSession(
      session,
      deps(new FakeForgeAdapter({ repo })),
    );

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "noMainBranch" },
    });
  });

  it("maps an inspect failure the same way inspecting does", async () => {
    adapter.failNext("inspect", new ForgeError("Unauthorized"));

    const result = await resumeSession(session, deps(adapter));

    expect(result).toEqual({ kind: "failed", error: { kind: "unauthorized" } });
  });
});

describe("listRepositories", () => {
  function providerListing(
    listing: () => Promise<RepositorySummary[]>,
  ): ForgeProvider {
    return {
      id: "github",
      name: "GitHub",
      accessTokenCreationUrl: () => "https://example.test/token",
      repositoryCreationUrl: () => "https://example.test/new",
      listRepositories: vi.fn(listing),
      createAdapter: () => new FakeForgeAdapter(),
    };
  }

  function summary(owner: string, repo: string): RepositorySummary {
    return {
      coordinates: { forge: "github", owner, repo },
      url: `https://github.com/${owner}/${repo}`,
      private: true,
    };
  }

  it("lists the token's repositories sorted by owner/repo, with the token trimmed", async () => {
    const provider = providerListing(async () => [
      summary("bob", "notes"),
      summary("alice", "zeta"),
      summary("alice", "notes"),
    ]);

    const result = await listRepositories(provider, "  token  ");

    expect(result).toEqual({
      kind: "listed",
      repositories: [
        summary("alice", "notes"),
        summary("alice", "zeta"),
        summary("bob", "notes"),
      ],
    });
    expect(provider.listRepositories).toHaveBeenCalledWith("token");
  });

  it.each([
    ["Unauthorized", new ForgeError("Unauthorized"), { kind: "unauthorized" }],
    ["Network", new ForgeError("Network"), { kind: "network" }],
    [
      "RateLimited",
      new ForgeError("RateLimited", { retryAfterMs: 5_000 }),
      { kind: "rateLimited", retryAfterMs: 5_000 },
    ],
  ])("maps a %s listing failure", async (_label, forgeError, error) => {
    const provider = providerListing(() => Promise.reject(forgeError));

    expect(await listRepositories(provider, "token")).toEqual({
      kind: "failed",
      error,
    });
  });
});
