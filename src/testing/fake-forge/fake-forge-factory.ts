import type { Argon2idFunction } from "../../crypto/argon2";
import { argon2idInWorker } from "../../crypto/argon2";
import type { Keyring } from "../../crypto/keyring";
import { deriveKeyring } from "../../crypto/keyring";
import { encryptPath } from "../../crypto/name-cipher";
import { encryptNote } from "../../crypto/note-cipher";
import { parseRepoConfig } from "../../crypto/repo-config";
import type { ForgeErrorKind } from "../../forge/errors";
import { ForgeError } from "../../forge/errors";
import { FakeForgeAdapter } from "../../forge/fake/fake-forge-adapter";
import {
  commitFiles,
  InMemoryGitRepo,
} from "../../forge/fake/in-memory-git-repo";
import type { ForgeAdapter } from "../../forge/forge-adapter";
import type { ForgeAdapterFactory } from "../../forge/registry";
import {
  INITIALIZE_SUBJECT,
  MAIN_BRANCH,
  REPO_CONFIG_PATH,
  SAVE_SUBJECT,
} from "../../format/v1";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../sample-notes-repo/sample-source";
import {
  createSampleNotesRepoAdapter,
  sampleNotesRepo,
} from "../sample-notes-repo/seed-sample-notes-repo";

export const FAKE_FORGE_BANNER = "Test mode: fake forge, no network";
export const FAKE_FORGE_INVALID_TOKEN = "invalid-token";
export const FAKE_FORGE_CONTROLS_KEY = "__commitNoteFakeForge";

export interface FakeForgeControls {
  /**
   * Commit as another device would: write `markdown` at the note path
   * (created or replaced), in the fixture repo `repoKey` ("sample/notes").
   */
  editNote(
    repoKey: string,
    notePath: readonly string[],
    markdown: string,
    passphrase?: string,
  ): Promise<void>;
  /**
   * Make the next call of `operation` on that fixture fail with a
   * ForgeError of `kind` (or "stale" for commit).
   */
  failNext(
    repoKey: string,
    operation: "getHead" | "listTree" | "readBlob" | "commit",
    kind: ForgeErrorKind | "stale",
  ): void;
}

function createRejectingAdapter(makeError: () => ForgeError): ForgeAdapter {
  const reject = () => Promise.reject(makeError());
  return {
    inspect: reject,
    initialize: reject,
    getHead: reject,
    listTree: reject,
    readBlob: reject,
    commit: reject,
  };
}

function unauthorizedAdapter(): ForgeAdapter {
  return createRejectingAdapter(() => new ForgeError("Unauthorized"));
}

function notFoundAdapter(): ForgeAdapter {
  return createRejectingAdapter(
    () =>
      new ForgeError("NotFound", {
        message: "No such fixture repository in fake forge mode",
      }),
  );
}

async function createForeignRepoAdapter(): Promise<FakeForgeAdapter> {
  const repo = new InMemoryGitRepo();
  await commitFiles(repo, {
    parent: null,
    files: { "README.md": "# Not a notes repo\n" },
    message: INITIALIZE_SUBJECT,
    branch: MAIN_BRANCH,
  });
  return new FakeForgeAdapter({ repo });
}

async function createNewerRepoAdapter(): Promise<FakeForgeAdapter> {
  const sampleConfigText = sampleNotesRepo.commits[0].files[REPO_CONFIG_PATH];
  const newerConfig = JSON.parse(sampleConfigText) as Record<string, unknown>;
  newerConfig.formatVersion = 2;
  const newerConfigText = JSON.stringify(newerConfig, null, 2) + "\n";

  const repo = new InMemoryGitRepo();
  await commitFiles(repo, {
    parent: null,
    files: { [REPO_CONFIG_PATH]: newerConfigText },
    message: INITIALIZE_SUBJECT,
    branch: MAIN_BRANCH,
  });
  return new FakeForgeAdapter({ repo });
}

export async function createFakeForge(options?: {
  readonly argon2id?: Argon2idFunction;
}): Promise<{ factory: ForgeAdapterFactory; controls: FakeForgeControls }> {
  const argon2id = options?.argon2id ?? argon2idInWorker;

  const fixtures = new Map<string, ForgeAdapter>([
    ["sample/notes", await createSampleNotesRepoAdapter()],
    ["sample/empty", new FakeForgeAdapter({ defaultBranch: "master" })],
    ["sample/empty-read-only", new FakeForgeAdapter({ canWrite: false })],
    [
      "sample/read-only",
      await createSampleNotesRepoAdapter({ canWrite: false }),
    ],
    ["sample/foreign", await createForeignRepoAdapter()],
    ["sample/newer", await createNewerRepoAdapter()],
  ]);

  const keyrings = new Map<string, Promise<Keyring>>();

  function fixtureAdapter(repoKey: string): FakeForgeAdapter {
    const adapter = fixtures.get(repoKey.toLowerCase());
    if (!(adapter instanceof FakeForgeAdapter)) {
      throw new Error(`No fake forge fixture named '${repoKey}'`);
    }
    return adapter;
  }

  async function keyringFor(
    repoKey: string,
    adapter: FakeForgeAdapter,
    passphrase: string,
  ): Promise<Keyring> {
    const cacheKey = repoKey.toLowerCase();
    let cached = keyrings.get(cacheKey);
    if (cached === undefined) {
      cached = (async () => {
        const inspection = await adapter.inspect();
        const repoConfigText =
          inspection.kind === "populated"
            ? (inspection.main?.repoConfigText ?? null)
            : null;
        if (repoConfigText === null) {
          throw new Error(`Fake forge fixture '${repoKey}' has no repo config`);
        }
        const parsed = parseRepoConfig(repoConfigText);
        if (parsed.kind !== "valid") {
          throw new Error(
            `Fake forge fixture '${repoKey}' has an invalid repo config`,
          );
        }
        return deriveKeyring(passphrase, parsed.config.kdf, argon2id);
      })();
      keyrings.set(cacheKey, cached);
    }
    return cached;
  }

  const controls: FakeForgeControls = {
    async editNote(repoKey, notePath, markdown, passphrase) {
      const adapter = fixtureAdapter(repoKey);
      const keyring = await keyringFor(
        repoKey,
        adapter,
        passphrase ?? SAMPLE_NOTES_REPO_PASSPHRASE,
      );
      const storedPath = await encryptPath(keyring, notePath);
      const text = await encryptNote(keyring, markdown);
      await adapter.pushFromAnotherDevice(
        [{ kind: "upsert-text", path: storedPath, text }],
        SAVE_SUBJECT,
      );
    },
    failNext(repoKey, operation, kind) {
      const adapter = fixtureAdapter(repoKey);
      adapter.failNext(
        operation,
        kind === "stale" ? "stale" : new ForgeError(kind),
      );
    },
  };

  const factory: ForgeAdapterFactory = (coordinates, factoryOptions) => {
    if (factoryOptions.accessToken === FAKE_FORGE_INVALID_TOKEN) {
      return unauthorizedAdapter();
    }
    const key = `${coordinates.owner}/${coordinates.repo}`.toLowerCase();
    return fixtures.get(key) ?? notFoundAdapter();
  };

  return { factory, controls };
}

export async function createFakeForgeFactory(): Promise<ForgeAdapterFactory> {
  return (await createFakeForge()).factory;
}
