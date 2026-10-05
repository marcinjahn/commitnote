import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer, type SetupServer } from "msw/node";
import { commitFiles } from "../forge/fake/in-memory-git-repo";
import type { ForgeAdapter } from "../forge/forge-adapter";
import { createGitLabAdapter } from "../forge/gitlab/gitlab-adapter";
import {
  MockGitLabRepo,
  type MockGitLabRepoOptions,
} from "../forge/gitlab/testing/mock-gitlab-server";
import type { Keyring } from "../crypto/keyring";
import { CHANGE_PASSPHRASE_SUBJECT, MAIN_BRANCH } from "../format/v1";
import { createRateBudget } from "../sync/rate-budget";
import { createSyncEngine } from "../sync/sync-engine";
import { createTestClock } from "../sync/testing/test-clock";
import {
  commitPassphraseChange,
  preparePassphraseChange,
  type PassphraseChangeDeps,
} from "./change-passphrase";
import { fastArgon2id } from "../crypto/testing/test-keyring";
import {
  createRekeyFixtureFiles,
  decryptTree,
  keyStateOf,
  NEW_PASSPHRASE,
  OLD_PASSPHRASE,
  readTree,
} from "./testing/rekey-fixture";

const PROJECT = "acme/notes";
const TOKEN = "s3cr3t-token";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const INPUT = {
  currentPassphrase: OLD_PASSPHRASE,
  newPassphrase: NEW_PASSPHRASE,
};

let server: SetupServer;

beforeAll(() => {
  server = setupServer();
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

async function setup(options?: Partial<MockGitLabRepoOptions>) {
  const mock = new MockGitLabRepo({
    projectPath: PROJECT,
    token: TOKEN,
    mergeMethod: "ff",
    maintainer: true,
    now: () => NOW,
    ...options,
  });
  server.use(...mock.handlers());
  const { files, keyring } = await createRekeyFixtureFiles();
  const head = await commitFiles(mock.git, {
    parent: null,
    files,
    message: "seed",
    branch: MAIN_BRANCH,
  });
  const adapter: ForgeAdapter = createGitLabAdapter(
    { owner: "acme", repo: "notes" },
    {
      accessToken: TOKEN,
      now: () => NOW,
      sleep: async () => {},
      randomId: () => "0000-1111",
    },
  );
  const clock = createTestClock(NOW);
  const engine = createSyncEngine({ adapter, keyring, clock });
  await engine.refresh();
  const deps: PassphraseChangeDeps = {
    adapter,
    engine,
    rateBudget: createRateBudget(clock, adapter.limits),
    clock,
    argon2id: fastArgon2id,
    sleep: async () => {},
  };
  const before = await decryptTree((await readTree(adapter)).files, keyring);
  return { mock, adapter, engine, deps, keyring, head, before };
}

describe("changing the passphrase on GitLab", () => {
  it("lands the whole re-encryption as one fast-forward commit", async () => {
    const h = await setup();

    const prepared = await preparePassphraseChange(h.deps, INPUT);
    if (!prepared.ok) throw new Error(prepared.failure.kind);
    const result = await commitPassphraseChange(h.deps, prepared.prepared);
    if (!result.ok) throw new Error(result.failure.kind);

    const main = h.mock.git.getRef(MAIN_BRANCH)!;
    const commit = h.mock.git.getCommit(main)!;
    expect(commit.parent).toBe(h.head);
    expect(commit.message.split("\n")[0]).toBe(CHANGE_PASSPHRASE_SUBJECT);
    const { files } = await readTree(h.adapter);
    expect(await keyStateOf(files, h.keyring, result.keyring)).toBe("new");
    expect(await decryptTree(files, result.keyring)).toEqual(h.before);
  });

  it("reports success when GitLab is still merging after the merge request", async () => {
    const h = await setup();
    h.mock.mergeLockedReads = 3;

    const prepared = await preparePassphraseChange(h.deps, INPUT);
    if (!prepared.ok) throw new Error(prepared.failure.kind);
    const result = await commitPassphraseChange(h.deps, prepared.prepared);

    expect(result).toMatchObject({ ok: true, check: "matched" });
    expect(h.mock.git.getCommit(h.mock.git.getRef(MAIN_BRANCH)!)!.parent).toBe(
      h.head,
    );
  });

  it("asks for the fast-forward setting before reading the notes", async () => {
    const h = await setup({ mergeMethod: "merge" });

    const result = await preparePassphraseChange(h.deps, INPUT);

    expect(result).toEqual({
      ok: false,
      failure: { kind: "needsSetup", canConfigure: true },
    });
    expect(h.mock.git.getRef(MAIN_BRANCH)).toBe(h.head);
    expect(h.engine.getState().suspended).toBe(false);
  });

  it("keeps an old-key device from landing a new folder while the change lands", async () => {
    const h = await setup();
    const staleAdapter = createGitLabAdapter(
      { owner: "acme", repo: "notes" },
      { accessToken: TOKEN, now: () => NOW, sleep: async () => {} },
    );
    const stale = createSyncEngine({
      adapter: staleAdapter,
      keyring: h.keyring,
      clock: createTestClock(NOW),
    });
    await stale.refresh();
    let changed: Keyring | null = null;
    h.mock.beforeCommitToMain = async () => {
      const prepared = await preparePassphraseChange(h.deps, INPUT);
      if (!prepared.ok) throw new Error(prepared.failure.kind);
      const result = await commitPassphraseChange(h.deps, prepared.prepared);
      if (!result.ok) throw new Error(result.failure.kind);
      changed = result.keyring;
    };

    expect(stale.createFolder([], "Made on the stale device").ok).toBe(true);
    await stale.flush();

    expect(changed).not.toBeNull();
    expect(stale.getState().stopped).toEqual({ kind: "keyChanged" });
    expect(stale.getState().syncStates.unsavedCount).toBe(1);
    const { files } = await readTree(h.adapter);
    expect(await keyStateOf(files, h.keyring, changed!)).toBe("new");
    expect(await decryptTree(files, changed!)).toEqual(h.before);
  });
});
