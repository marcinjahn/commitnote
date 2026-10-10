import {
  FakeForgeAdapter,
  type FakeForgeAdapterShares,
} from "../../forge/fake/fake-forge-adapter";
import {
  InMemoryGitRepo,
  seedCommits,
} from "../../forge/fake/in-memory-git-repo";
import type { ForgeAdapterOptions } from "../../forge/forge-adapter";
import type { SampleNotesRepo } from "./generate-sample-notes-repo";
import sampleNotesRepoJson from "./sample-notes-repo.json";
import sampleSearchRepoJson from "./sample-search-repo.json";
import sampleTrashRepoJson from "./sample-trash-repo.json";

// Each commit's `files` has a different literal key set, so TS infers a
// union of narrow object shapes instead of the generic Record<string,
// string> the JSON actually holds; the runtime shape matches SampleNotesRepo
// exactly (it's the same value this file's sibling script last wrote out).
export const sampleNotesRepo: SampleNotesRepo =
  sampleNotesRepoJson as unknown as SampleNotesRepo;

export const sampleTrashRepo: SampleNotesRepo =
  sampleTrashRepoJson as unknown as SampleNotesRepo;

export const sampleSearchRepo: SampleNotesRepo =
  sampleSearchRepoJson as unknown as SampleNotesRepo;

export function createSampleNotesRepoAdapter(options?: SampleRepoAdapterOptions) {
  return createAdapterFor(sampleNotesRepo, options);
}

export function createSampleTrashRepoAdapter(options?: SampleRepoAdapterOptions) {
  return createAdapterFor(sampleTrashRepo, options);
}

export function createSampleSearchRepoAdapter(options?: SampleRepoAdapterOptions) {
  return createAdapterFor(sampleSearchRepo, options);
}

interface SampleRepoAdapterOptions {
  readonly canWrite?: boolean;
  readonly onContentCreatingRequest?: ForgeAdapterOptions["onContentCreatingRequest"];
  readonly shares?: FakeForgeAdapterShares;
}

export async function createAdapterFor(
  fixture: SampleNotesRepo,
  options?: SampleRepoAdapterOptions,
): Promise<FakeForgeAdapter> {
  const repo = new InMemoryGitRepo();
  await seedCommits(repo, fixture.commits);

  return new FakeForgeAdapter({
    repo,
    canWrite: options?.canWrite,
    onContentCreatingRequest: options?.onContentCreatingRequest,
    shares: options?.shares,
  });
}
