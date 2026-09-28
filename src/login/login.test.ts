import { beforeAll, describe, expect, it, vi } from "vitest";
import { encodeInitializeMessage } from "../changes/encode-change-set";
import { argon2idDirect } from "../crypto/argon2";
import { deriveKeyring, verifyKeyCheck } from "../crypto/keyring";
import { parseRepoConfig, type RepoConfig } from "../crypto/repo-config";
import { ForgeError } from "../forge/errors";
import { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { commitFiles, InMemoryGitRepo } from "../forge/fake/in-memory-git-repo";
import { APP_ID, MAIN_BRANCH, REPO_CONFIG_PATH } from "../format/v1";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../testing/sample-notes-repo/sample-source";
import {
  initializeNotesRepo,
  logIn,
  resumeSession,
  type LoginDependencies,
  type LoginResult,
  type LoginStep,
} from "./login";
import type { Session } from "../session/session";

const REPO_URL = "https://github.com/alice/notes";

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
        repoUrl: `  ${REPO_URL}  `,
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
      { repoUrl: REPO_URL, accessToken: "token", passphrase: "wrong one" },
      deps(adapter),
    );

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "wrongPassphrase" },
    });
  });

  it.each([
    ["a malformed URL", "not a url", { kind: "malformed" }],
    [
      "a non-GitHub host",
      "https://gitlab.com/alice/notes",
      { kind: "unsupportedForge", host: "gitlab.com" },
    ],
  ])(
    "returns a repoUrl error for %s, without creating an adapter",
    async (_label, repoUrl, error) => {
      const createAdapter = vi.fn();

      const result = await logIn(
        { repoUrl, accessToken: "token", passphrase: "x" },
        { createAdapter, argon2id: argon2idDirect },
      );

      expect(result).toEqual({
        kind: "failed",
        error: { kind: "repoUrl", error },
      });
      expect(createAdapter).not.toHaveBeenCalled();
    },
  );

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
      { repoUrl: REPO_URL, accessToken: "token", passphrase: "x" },
      deps(adapter),
    );

    expect(result).toEqual({ kind: "failed", error });
  });

  it("rejects a read-only access token for a populated repo, before deriving keys", async () => {
    const adapter = await createSampleNotesRepoAdapter({ canWrite: false });

    const result = await logIn(
      {
        repoUrl: REPO_URL,
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
      { repoUrl: REPO_URL, accessToken: "token", passphrase: "x" },
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
      { repoUrl: REPO_URL, accessToken: "token", passphrase: "x" },
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
      { repoUrl: REPO_URL, accessToken: "token", passphrase: "x" },
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
      { repoUrl: REPO_URL, accessToken: "token", passphrase: "x" },
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
      { repoUrl: REPO_URL, accessToken: "token", passphrase: "x" },
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
      { repoUrl: REPO_URL, accessToken: "token", passphrase },
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
    expect(commit?.message).toBe(encodeInitializeMessage());

    const entries = await adapter.listTree(head as string);
    const fileEntries = entries.filter((entry) => entry.type === "blob");
    expect(fileEntries).toHaveLength(1);
    expect(fileEntries[0].path).toBe(REPO_CONFIG_PATH);

    const configText = await adapter.readBlob(fileEntries[0].sha);
    expect(parseRepoConfig(configText).kind).toBe("valid");

    const sameLogin = await logIn(
      { repoUrl: REPO_URL, accessToken: "token", passphrase },
      deps(adapter),
    );
    expectLoggedIn(sameLogin);

    const wrongLogin = await logIn(
      { repoUrl: REPO_URL, accessToken: "token", passphrase: "another one" },
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
      { repoUrl: REPO_URL, accessToken: "token", passphrase },
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
        repoUrl: REPO_URL,
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
