import { beforeAll, describe, expect, it, vi } from "vitest";
import { encodeInitializeMessage } from "../changes/encode-change-set";
import { argon2idDirect } from "../crypto/argon2";
import { deriveKeyring, verifyKeyCheck } from "../crypto/keyring";
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
  initializeNotesRepo,
  listRepositories,
  logIn,
  resumeSession,
  type LoginDependencies,
  type LoginResult,
  type LoginStep,
} from "./login";
import type { Session } from "../session/session";

const REPO_URL = "https://github.com/alice/notes";
const REPOSITORY: RepositorySummary = {
  coordinates: { forge: "github", owner: "alice", repo: "notes" },
  url: REPO_URL,
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

describe("logIn", () => {
  it("logs in to the sample notes repo with its passphrase", async () => {
    const adapter = await createSampleNotesRepoAdapter();
    const steps: LoginStep[] = [];

    const result = await logIn(
      {
        repository: REPOSITORY,
        accessToken: "  token  ",
        passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
      },
      deps(adapter),
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

    const result = await logIn(
      { repository: REPOSITORY, accessToken: "token", passphrase: "wrong one" },
      deps(adapter),
    );

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

    const result = await logIn(
      { repository: REPOSITORY, accessToken: "token", passphrase: "x" },
      deps(adapter),
    );

    expect(result).toEqual({ kind: "failed", error });
  });

  it("rejects a read-only access token for a populated repo, before deriving keys", async () => {
    const adapter = await createSampleNotesRepoAdapter({ canWrite: false });

    const result = await logIn(
      {
        repository: REPOSITORY,
        accessToken: "token",
        passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
      },
      deps(adapter),
    );

    expect(result).toEqual({ kind: "failed", error: { kind: "readOnly" } });
  });

  it("rejects a read-only access token for an empty repo", async () => {
    const adapter = new FakeForgeAdapter({ canWrite: false });

    const result = await logIn(
      { repository: REPOSITORY, accessToken: "token", passphrase: "x" },
      deps(adapter),
    );

    expect(result).toEqual({ kind: "failed", error: { kind: "readOnly" } });
  });

  it("treats a populated repo whose main branch is missing as foreign, writing nothing", async () => {
    const repo = new InMemoryGitRepo();
    const otherHead = await commitFiles(repo, {
      parent: null,
      files: { "note.txt": "hello" },
      message: "commit to another branch",
      branch: "other",
    });
    const adapter = new FakeForgeAdapter({ repo });

    const result = await logIn(
      { repository: REPOSITORY, accessToken: "token", passphrase: "x" },
      deps(adapter),
    );

    expect(result).toEqual({ kind: "failed", error: { kind: "foreign" } });
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

    const result = await logIn(
      { repository: REPOSITORY, accessToken: "token", passphrase: "x" },
      deps(adapter),
    );

    expect(result).toEqual({ kind: "failed", error: { kind: "foreign" } });
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

    const result = await logIn(
      { repository: REPOSITORY, accessToken: "token", passphrase: "x" },
      deps(adapter),
    );

    expect(result).toEqual({ kind: "failed", error: { kind: "foreign" } });
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

    const result = await logIn(
      { repository: REPOSITORY, accessToken: "token", passphrase: "x" },
      deps(adapter),
    );

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "newerFormat", formatVersion: 2 },
    });
    expect(repo.getRef(MAIN_BRANCH)).toBe(head);
  });

  it("initializes an empty repository end-to-end, after which the same passphrase logs in and a wrong one does not", async () => {
    const adapter = new FakeForgeAdapter({ defaultBranch: "master" });
    const passphrase = "a fresh passphrase";

    const needsInit = await logIn(
      { repository: REPOSITORY, accessToken: "token", passphrase },
      deps(adapter),
    );
    expect(needsInit.kind).toBe("needsInitialization");
    if (needsInit.kind !== "needsInitialization") {
      throw new Error("expected needsInitialization");
    }
    expect(adapter.repo.hasCommits()).toBe(false);

    const steps: LoginStep[] = [];
    const initResult = await initializeNotesRepo(
      needsInit.pending,
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

    const sameLogin = await logIn(
      { repository: REPOSITORY, accessToken: "token", passphrase },
      deps(adapter),
    );
    expectLoggedIn(sameLogin);

    const wrongLogin = await logIn(
      { repository: REPOSITORY, accessToken: "token", passphrase: "another one" },
      deps(adapter),
    );
    expect(wrongLogin).toEqual({
      kind: "failed",
      error: { kind: "wrongPassphrase" },
    });
  });

  it("reports initializationRaced when initialize comes back stale", async () => {
    const adapter = new FakeForgeAdapter();
    const passphrase = "a passphrase";

    const needsInit = await logIn(
      { repository: REPOSITORY, accessToken: "token", passphrase },
      deps(adapter),
    );
    if (needsInit.kind !== "needsInitialization") {
      throw new Error("expected needsInitialization");
    }

    adapter.failNext("initialize", "stale");
    const result = await initializeNotesRepo(
      needsInit.pending,
      passphrase,
      deps(adapter),
    );

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "initializationRaced" },
    });
  });
});

describe("resumeSession", () => {
  let adapter: FakeForgeAdapter;
  let session: Session;

  beforeAll(async () => {
    adapter = await createSampleNotesRepoAdapter();
    const loginResult = await logIn(
      {
        repository: REPOSITORY,
        accessToken: "token",
        passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
      },
      deps(adapter),
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

  it("maps an inspect failure the same way logIn does", async () => {
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
      listRepositories: vi.fn(listing),
      createAdapter: () => new FakeForgeAdapter(),
    };
  }

  function summary(owner: string, repo: string): RepositorySummary {
    return {
      coordinates: { forge: "github", owner, repo },
      url: `https://github.com/${owner}/${repo}`,
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
