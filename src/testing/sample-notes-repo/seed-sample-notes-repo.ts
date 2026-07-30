import { FakeForgeAdapter } from "../../forge/fake/fake-forge-adapter";
import {
  commitFiles,
  InMemoryGitRepo,
} from "../../forge/fake/in-memory-git-repo";
import type { ForgeAdapterOptions } from "../../forge/forge-adapter";
import { MAIN_BRANCH } from "../../format/v1";
import type { SampleNotesRepo } from "./generate-sample-notes-repo";
import sampleNotesRepoJson from "./sample-notes-repo.json";

// Each commit's `files` has a different literal key set, so TS infers a
// union of narrow object shapes instead of the generic Record<string,
// string> the JSON actually holds; the runtime shape matches SampleNotesRepo
// exactly (it's the same value this file's sibling script last wrote out).
export const sampleNotesRepo: SampleNotesRepo =
  sampleNotesRepoJson as unknown as SampleNotesRepo;

export async function createSampleNotesRepoAdapter(options?: {
  readonly canWrite?: boolean;
  readonly onContentCreatingRequest?: ForgeAdapterOptions["onContentCreatingRequest"];
}): Promise<FakeForgeAdapter> {
  const repo = new InMemoryGitRepo();
  const commits = sampleNotesRepo.commits;

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
