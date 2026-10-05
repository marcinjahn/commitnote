import type { Argon2idFunction } from "../../crypto/argon2";
import { argon2idInWorker } from "../../crypto/argon2";
import type { Keyring } from "../../crypto/keyring";
import { deriveKeyring } from "../../crypto/keyring";
import { toBase64 } from "../../crypto/base64";
import { encryptPath } from "../../crypto/name-cipher";
import { encryptNote } from "../../crypto/note-cipher";
import { parseRepoConfig } from "../../crypto/repo-config";
import type { ForgeErrorKind } from "../../forge/errors";
import { ForgeError } from "../../forge/errors";
import {
  type FailableOperation,
  FakeForgeAdapter,
} from "../../forge/fake/fake-forge-adapter";
import {
  commitFiles,
  InMemoryGitRepo,
  type GitObjectsSnapshot,
} from "../../forge/fake/in-memory-git-repo";
import type { ForgeAdapter } from "../../forge/forge-adapter";
import type {
  ForgeProvider,
  RepositorySummary,
} from "../../forge/forge-provider";
import type { ForgeId } from "../../forge/repo-coordinates";
import {
  GITHUB_WRITE_LIMITS,
  gitHubCommitCost,
} from "../../forge/github/github-adapter";
import { createGitHubProvider } from "../../forge/github/github-provider";
import type {
  ForgeAdapterFactory,
  ForgeRegistry,
} from "../../forge/registry";
import {
  INITIALIZE_SUBJECT,
  MAIN_BRANCH,
  REPO_CONFIG_PATH,
  SAVE_SUBJECT,
} from "../../format/v1";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../sample-notes-repo/sample-source";
import {
  createSampleNotesRepoAdapter,
  createSampleTrashRepoAdapter,
  sampleNotesRepo,
} from "../sample-notes-repo/seed-sample-notes-repo";
import { delay, type ForgeLatency, withLatency } from "./forge-latency";

export const FAKE_FORGE_BANNER = "Test mode: fake forge, no network";
export const FAKE_FORGE_INVALID_TOKEN = "invalid-token";
export const FAKE_FORGE_NO_REPOSITORIES_TOKEN = "no-repositories-token";
export const SECOND_FAKE_FORGE_NAME = "Fakelab";
export const SECOND_FAKE_FORGE_URL_PREFIX = "https://fakelab.test/";
// Stands in for the second real provider so the login UI can be exercised with
// several providers; only its display name and fixtures differ.
const SECOND_FAKE_FORGE_ID: ForgeId = "gitlab";
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
  /** Messages of the commits on main of `repoKey`, newest first. */
  commitMessages(repoKey: string): string[];
  /**
   * Commit a repo config whose key check no longer matches, as a passphrase
   * change on another device would.
   */
  changeRepoKey(repoKey: string): Promise<void>;
  /** Objects and main head of `repoKey`, to hand to another browser context. */
  exportRepo(repoKey: string): string;
  /**
   * Fast-forward `repoKey` to a state exported by another browser context,
   * as if that context's commits were pushed from another device.
   */
  adoptRepo(repoKey: string, exported: string): void;
  /**
   * Make the next call of `operation` on that fixture fail with a
   * ForgeError of `kind` (or "stale" for commit and replaceHistory).
   */
  failNext(
    repoKey: string,
    operation: Exclude<FailableOperation, "initialize" | "findOldestCommit">,
    kind: ForgeErrorKind | "stale",
  ): void;
}

function createRejectingAdapter(makeError: () => ForgeError): ForgeAdapter {
  const reject = () => Promise.reject(makeError());
  return {
    limits: GITHUB_WRITE_LIMITS,
    commitCost: gitHubCommitCost,
    inspect: reject,
    initialize: reject,
    getHead: reject,
    listTree: reject,
    listCommits: reject,
    findOldestCommit: reject,
    readFileAt: reject,
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
    files: {
      "README.md": "# Not a notes repo\n",
      "index.js": 'console.log("hello");\n',
    },
    message: INITIALIZE_SUBJECT,
    branch: MAIN_BRANCH,
  });
  return new FakeForgeAdapter({ repo });
}

async function createAlmostEmptyRepoAdapter(): Promise<FakeForgeAdapter> {
  const repo = new InMemoryGitRepo();
  await commitFiles(repo, {
    parent: null,
    files: {
      "README.md": "# notes\n",
      LICENSE: "MIT License\n",
      ".gitignore": "node_modules/\n",
    },
    message: "Initial commit",
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
  readonly latency?: ForgeLatency;
}): Promise<{
  factory: ForgeAdapterFactory;
  registry: ForgeRegistry;
  controls: FakeForgeControls;
}> {
  const argon2id = options?.argon2id ?? argon2idInWorker;
  const latency = options?.latency;
  const slowed = (adapter: ForgeAdapter): ForgeAdapter =>
    latency === undefined ? adapter : withLatency(adapter, latency);

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
    ["sample/trash", await createSampleTrashRepoAdapter()],
    ["sample/almost-empty", await createAlmostEmptyRepoAdapter()],
    ["sample/public-empty", new FakeForgeAdapter()],
  ]);
  const publicFixtures: ReadonlySet<string> = new Set(["sample/public-empty"]);

  const keyrings = new Map<string, Promise<Keyring>>();

  function fixtureAdapter(repoKey: string): FakeForgeAdapter {
    const adapter = fixtures.get(repoKey.toLowerCase());
    if (!(adapter instanceof FakeForgeAdapter)) {
      throw new Error(`No fake forge fixture named '${repoKey}'`);
    }
    return adapter;
  }

  async function fixtureConfigText(
    repoKey: string,
    adapter: FakeForgeAdapter,
  ): Promise<string> {
    const inspection = await adapter.inspect();
    const repoConfigText =
      inspection.kind === "populated"
        ? (inspection.main?.repoConfigText ?? null)
        : null;
    if (repoConfigText === null) {
      throw new Error(`Fake forge fixture '${repoKey}' has no repo config`);
    }
    return repoConfigText;
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
        const repoConfigText = await fixtureConfigText(repoKey, adapter);
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
    commitMessages(repoKey) {
      const { repo } = fixtureAdapter(repoKey);
      const messages: string[] = [];
      let sha = repo.getRef("main") ?? null;
      while (sha !== null) {
        const commit = repo.getCommit(sha);
        if (commit === undefined) break;
        messages.push(commit.message);
        sha = commit.parent;
      }
      return messages;
    },
    async changeRepoKey(repoKey) {
      const adapter = fixtureAdapter(repoKey);
      const configText = await fixtureConfigText(repoKey, adapter);
      const config = JSON.parse(configText) as Record<string, unknown>;
      config.keyCheck = toBase64(new Uint8Array(32).fill(7));
      await adapter.pushFromAnotherDevice(
        [
          {
            kind: "upsert-text",
            path: REPO_CONFIG_PATH,
            text: JSON.stringify(config, null, 2) + "\n",
          },
        ],
        SAVE_SUBJECT,
      );
    },
    exportRepo(repoKey) {
      const { repo } = fixtureAdapter(repoKey);
      return JSON.stringify({
        objects: repo.exportObjects(),
        main: repo.getRef(MAIN_BRANCH) ?? null,
      });
    },
    adoptRepo(repoKey, exported) {
      const { repo } = fixtureAdapter(repoKey);
      const { objects, main } = JSON.parse(exported) as {
        objects: GitObjectsSnapshot;
        main: string | null;
      };
      repo.importObjects(objects);
      if (main !== null) repo.setRef(MAIN_BRANCH, main);
    },
    failNext(repoKey, operation, kind) {
      const adapter = fixtureAdapter(repoKey);
      adapter.failNext(
        operation,
        kind === "stale" ? "stale" : new ForgeError(kind),
      );
    },
  };

  const fixtureFactory =
    (fixtureMap: ReadonlyMap<string, ForgeAdapter>): ForgeAdapterFactory =>
    (coordinates, factoryOptions) => {
      if (factoryOptions.accessToken === FAKE_FORGE_INVALID_TOKEN) {
        return slowed(unauthorizedAdapter());
      }
      const key = `${coordinates.owner}/${coordinates.repo}`.toLowerCase();
      return slowed(fixtureMap.get(key) ?? notFoundAdapter());
    };
  const factory = fixtureFactory(fixtures);

  function fakeProvider(options: {
    readonly base: ForgeProvider;
    readonly fixtures: ReadonlyMap<string, ForgeAdapter>;
    readonly publicFixtures?: ReadonlySet<string>;
    readonly urlPrefix: string;
    readonly createAdapter: ForgeAdapterFactory;
  }): ForgeProvider {
    const forge = options.base.id;
    const repositories: RepositorySummary[] = [...options.fixtures.keys()].map(
      (key) => {
        const [owner, repo] = key.split("/");
        return {
          coordinates: { forge, owner, repo },
          url: `${options.urlPrefix}${key}`,
          private: options.publicFixtures?.has(key) !== true,
        };
      },
    );
    return {
      ...options.base,
      listRepositories: async (accessToken) => {
        if (latency !== undefined) await delay(latency.listRepositoriesMs);
        if (accessToken === FAKE_FORGE_INVALID_TOKEN) {
          throw new ForgeError("Unauthorized");
        }
        if (accessToken === FAKE_FORGE_NO_REPOSITORIES_TOKEN) return [];
        return repositories;
      },
      createAdapter: options.createAdapter,
    };
  }

  const secondFixtures = new Map<string, ForgeAdapter>([
    ["team/notes", await createSampleNotesRepoAdapter()],
    ["team/empty", new FakeForgeAdapter()],
  ]);

  const secondFactory = fixtureFactory(secondFixtures);

  const registry = {
    github: fakeProvider({
      base: createGitHubProvider(),
      fixtures,
      publicFixtures,
      urlPrefix: "https://github.com/",
      createAdapter: factory,
    }),
    gitlab: fakeProvider({
      base: {
        id: SECOND_FAKE_FORGE_ID,
        name: SECOND_FAKE_FORGE_NAME,
        accessTokenHint: "A Fakelab token with the write_repository scope.",
        accessTokenCreationUrl: () => `${SECOND_FAKE_FORGE_URL_PREFIX}tokens/new`,
        repositoryCreationUrl: () => `${SECOND_FAKE_FORGE_URL_PREFIX}projects/new`,
        listRepositories: () => Promise.resolve([]),
        createAdapter: secondFactory,
      },
      fixtures: secondFixtures,
      urlPrefix: SECOND_FAKE_FORGE_URL_PREFIX,
      createAdapter: secondFactory,
    }),
  };

  return { factory, registry, controls };
}
