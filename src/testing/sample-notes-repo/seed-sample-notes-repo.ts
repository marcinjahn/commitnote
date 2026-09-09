import { FakeForgeAdapter } from "../../forge/fake/fake-forge-adapter";
import {
  commitFiles,
  InMemoryGitRepo,
} from "../../forge/fake/in-memory-git-repo";
import type { ForgeAdapterOptions } from "../../forge/forge-adapter";
import { MAIN_BRANCH } from "../../format/v1";
import type { SampleNotesRepo } from "./generate-sample-notes-repo";
import sampleNotesRepoJson from "./sample-notes-repo.json";
import sampleTrashRepoJson from "./sample-trash-repo.json";

// Each commit's `files` has a different literal key set, so TS infers a
// union of narrow object shapes instead of the generic Record<string,
// string> the JSON actually holds; the runtime shape matches SampleNotesRepo
// exactly (it's the same value this file's sibling script last wrote out).
export const sampleNotesRepo: SampleNotesRepo =
  sampleNotesRepoJson as unknown as SampleNotesRepo;

export const sampleTrashRepo: SampleNotesRepo =
  sampleTrashRepoJson as unknown as SampleNotesRepo;

export function createSampleNotesRepoAdapter(options?: SampleRepoAdapterOptions) {
  return createAdapterFor(sampleNotesRepo, options);
}

export function createSampleTrashRepoAdapter(options?: SampleRepoAdapterOptions) {
  return createAdapterFor(sampleTrashRepo, options);
}

interface SampleRepoAdapterOptions {
  readonly canWrite?: boolean;
  readonly onContentCreatingRequest?: ForgeAdapterOptions["onContentCreatingRequest"];
}

async function createAdapterFor(
  fixture: SampleNotesRepo,
  options?: SampleRepoAdapterOptions,
): Promise<FakeForgeAdapter> {
  const repo = new InMemoryGitRepo();
  const commits = fixture.commits;

  let parent: string | null = null;
  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    parent = await commitFiles(repo, {
      parent,
      files: { ...commit.files },
      message: commit.message,
      branch: i === commits.length - 1 ? MAIN_BRANCH : undefined,
    });
  }

  return new FakeForgeAdapter({
    repo,
    canWrite: options?.canWrite,
    onContentCreatingRequest: options?.onContentCreatingRequest,
  });
}
