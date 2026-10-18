import type { FailableOperation } from "../../forge/fake/fake-forge-adapter";
import type { ForgeAdapter } from "../../forge/forge-adapter";

export type HoldableOperation = Exclude<
  FailableOperation,
  "initialize" | "findOldestCommit"
>;

export interface ForgeHolds {
  hold(repoKey: string, operation: HoldableOperation): void;
  release(repoKey: string, operation: HoldableOperation): void;
  wrap(repoKey: string, adapter: ForgeAdapter): ForgeAdapter;
}

export function createForgeHolds(): ForgeHolds {
  const held = new Map<string, Array<() => void>>();
  const holdKey = (repoKey: string, operation: HoldableOperation) =>
    `${repoKey.toLowerCase()}\n${operation}`;

  function gated<T>(
    repoKey: string,
    operation: HoldableOperation,
    run: () => Promise<T>,
  ): Promise<T> {
    const waiting = held.get(holdKey(repoKey, operation));
    if (waiting === undefined) return run();
    return new Promise<void>((resolve) => waiting.push(resolve)).then(run);
  }

  return {
    hold(repoKey, operation) {
      const key = holdKey(repoKey, operation);
      if (!held.has(key)) held.set(key, []);
    },
    release(repoKey, operation) {
      const key = holdKey(repoKey, operation);
      const waiting = held.get(key);
      if (waiting === undefined) return;
      held.delete(key);
      for (const resume of waiting) resume();
    },
    wrap(repoKey, adapter) {
      const replaceHistory = adapter.replaceHistory?.bind(adapter);
      const createBlob = adapter.createBlob?.bind(adapter);
      const shareHost = adapter.shareHost;
      const observedRateLimit = adapter.observedRateLimit?.bind(adapter);
      return {
        limits: adapter.limits,
        commitCost: (...args) => adapter.commitCost(...args),
        inspect: () => gated(repoKey, "inspect", () => adapter.inspect()),
        initialize: (...args) => adapter.initialize(...args),
        getHead: () => gated(repoKey, "getHead", () => adapter.getHead()),
        listTree: (...args) =>
          gated(repoKey, "listTree", () => adapter.listTree(...args)),
        readBlob: (...args) =>
          gated(repoKey, "readBlob", () => adapter.readBlob(...args)),
        readBlobBytes: (...args) =>
          gated(repoKey, "readBlob", () => adapter.readBlobBytes(...args)),
        commit: (...args) =>
          gated(repoKey, "commit", () => adapter.commit(...args)),
        listCommits: (...args) =>
          gated(repoKey, "listCommits", () => adapter.listCommits(...args)),
        findOldestCommit: (...args) => adapter.findOldestCommit(...args),
        readFileAt: (...args) =>
          gated(repoKey, "readFileAt", () => adapter.readFileAt(...args)),
        shareHost: {
          maxImages: shareHost.maxImages,
          create: (...args) =>
            gated(repoKey, "createShare", () => shareHost.create(...args)),
          update: (...args) =>
            gated(repoKey, "updateShare", () => shareHost.update(...args)),
          delete: (...args) =>
            gated(repoKey, "deleteShare", () => shareHost.delete(...args)),
        },
        ...(replaceHistory === undefined
          ? {}
          : {
              replaceHistory: (...args) =>
                gated(repoKey, "replaceHistory", () => replaceHistory(...args)),
            }),
        ...(createBlob === undefined
          ? {}
          : {
              createBlob: (...args) =>
                gated(repoKey, "commit", () => createBlob(...args)),
            }),
        ...(observedRateLimit === undefined ? {} : { observedRateLimit }),
      };
    },
  };
}
