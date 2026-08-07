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
} from "../../format/v1";
import {
  createSampleNotesRepoAdapter,
  sampleNotesRepo,
} from "../sample-notes-repo/seed-sample-notes-repo";

export const FAKE_FORGE_BANNER = "Test mode: fake forge, no network";
export const FAKE_FORGE_INVALID_TOKEN = "invalid-token";

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

export async function createFakeForgeFactory(): Promise<ForgeAdapterFactory> {
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

  return (coordinates, options) => {
    if (options.accessToken === FAKE_FORGE_INVALID_TOKEN) {
      return unauthorizedAdapter();
    }
    const key = `${coordinates.owner}/${coordinates.repo}`.toLowerCase();
    return fixtures.get(key) ?? notFoundAdapter();
  };
}
