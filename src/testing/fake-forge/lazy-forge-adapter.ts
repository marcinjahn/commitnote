import type { ForgeAdapter } from "../../forge/forge-adapter";
import {
  GITHUB_WRITE_LIMITS,
  gitHubCommitCost,
} from "../../forge/github/github-adapter";

export function createLazyForgeAdapter(
  create: () => Promise<ForgeAdapter>,
): ForgeAdapter {
  let adapter: Promise<ForgeAdapter> | undefined;
  const resolved = (): Promise<ForgeAdapter> => (adapter ??= create());

  return {
    limits: GITHUB_WRITE_LIMITS,
    commitCost: gitHubCommitCost,
    inspect: () => resolved().then((a) => a.inspect()),
    initialize: (...args) => resolved().then((a) => a.initialize(...args)),
    getHead: () => resolved().then((a) => a.getHead()),
    listTree: (...args) => resolved().then((a) => a.listTree(...args)),
    listCommits: (...args) => resolved().then((a) => a.listCommits(...args)),
    findOldestCommit: (...args) =>
      resolved().then((a) => a.findOldestCommit(...args)),
    readFileAt: (...args) => resolved().then((a) => a.readFileAt(...args)),
    readBlob: (...args) => resolved().then((a) => a.readBlob(...args)),
    commit: (...args) => resolved().then((a) => a.commit(...args)),
    shareHost: {
      create: (...args) => resolved().then((a) => a.shareHost.create(...args)),
      update: (...args) => resolved().then((a) => a.shareHost.update(...args)),
      delete: (...args) => resolved().then((a) => a.shareHost.delete(...args)),
    },
    replaceHistory: (...args) =>
      resolved().then((a) => {
        if (a.replaceHistory === undefined) {
          throw new Error("replaceHistory is not supported");
        }
        return a.replaceHistory(...args);
      }),
  };
}
