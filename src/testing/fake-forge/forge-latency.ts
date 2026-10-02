import type { ForgeAdapter } from "../../forge/forge-adapter";

export interface ForgeLatency {
  readonly listRepositoriesMs: number;
  readonly inspectMs: number;
  readonly initializeMs: number;
  readonly getHeadMs: number;
  readonly listTreeMs: number;
  readonly readBlobMs: number;
  readonly commitMs: number;
}

// A GitHub commit through the Git Data API is several sequential requests
// (blobs, tree, commit, ref update), so it is far slower than a single read.
export const GITHUB_LIKE_LATENCY: ForgeLatency = {
  listRepositoriesMs: 350,
  inspectMs: 400,
  initializeMs: 900,
  getHeadMs: 150,
  listTreeMs: 250,
  readBlobMs: 150,
  commitMs: 1200,
};

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayed<T>(ms: number, run: () => Promise<T>): Promise<T> {
  return delay(ms).then(run);
}

export function withLatency(
  adapter: ForgeAdapter,
  latency: ForgeLatency,
): ForgeAdapter {
  return {
    limits: adapter.limits,
    commitCost: (...args) => adapter.commitCost(...args),
    inspect: () => delayed(latency.inspectMs, () => adapter.inspect()),
    initialize: (...args) =>
      delayed(latency.initializeMs, () => adapter.initialize(...args)),
    getHead: () => delayed(latency.getHeadMs, () => adapter.getHead()),
    listTree: (...args) =>
      delayed(latency.listTreeMs, () => adapter.listTree(...args)),
    readBlob: (...args) =>
      delayed(latency.readBlobMs, () => adapter.readBlob(...args)),
    commit: (...args) =>
      delayed(latency.commitMs, () => adapter.commit(...args)),
  };
}
