import type { ForgeAdapter } from "../forge/forge-adapter";
import type { BlobCache } from "./blob-cache";

export function withBlobCache(
  inner: ForgeAdapter,
  cache: BlobCache,
): ForgeAdapter {
  return {
    limits: inner.limits,
    shareHost: inner.shareHost,
    commitCost: inner.commitCost.bind(inner),
    inspect: inner.inspect.bind(inner),
    initialize: inner.initialize.bind(inner),
    getHead: inner.getHead.bind(inner),
    listTree: inner.listTree.bind(inner),
    async readBlob(sha) {
      const hit = await cache.read(sha);
      if (hit !== null) return hit;
      const text = await inner.readBlob(sha);
      cache.fill(sha, text);
      return text;
    },
    async commit(request) {
      const result = await inner.commit(request);
      if (result.kind === "ok") cache.fillCommit(request.changes);
      return result;
    },
    listCommits: inner.listCommits.bind(inner),
    findOldestCommit: inner.findOldestCommit.bind(inner),
    readFileAt: inner.readFileAt.bind(inner),
    ...(inner.atomicCommitSupport
      ? { atomicCommitSupport: inner.atomicCommitSupport.bind(inner) }
      : {}),
    ...(inner.enableAtomicCommits
      ? { enableAtomicCommits: inner.enableAtomicCommits.bind(inner) }
      : {}),
    ...(inner.replaceHistory
      ? { replaceHistory: inner.replaceHistory.bind(inner) }
      : {}),
    ...(inner.sweepAbandoned
      ? { sweepAbandoned: inner.sweepAbandoned.bind(inner) }
      : {}),
    ...(inner.observedRateLimit
      ? { observedRateLimit: inner.observedRateLimit.bind(inner) }
      : {}),
  };
}
