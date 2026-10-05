import type { ForgeAdapter } from "../forge-adapter";

/**
 * Forwards the required members to `inner` and applies `overrides`. Optional
 * members stay absent unless an override provides them.
 */
export function delegateAdapter(
  inner: ForgeAdapter,
  overrides: Partial<ForgeAdapter> = {},
): ForgeAdapter {
  return {
    limits: inner.limits,
    commitCost: (changes, options) => inner.commitCost(changes, options),
    inspect: () => inner.inspect(),
    initialize: (configText, message) => inner.initialize(configText, message),
    getHead: () => inner.getHead(),
    listTree: (commitSha) => inner.listTree(commitSha),
    readBlob: (sha) => inner.readBlob(sha),
    commit: (request) => inner.commit(request),
    listCommits: (request) => inner.listCommits(request),
    findOldestCommit: (request) => inner.findOldestCommit(request),
    readFileAt: (commitSha, path) => inner.readFileAt(commitSha, path),
    ...overrides,
  };
}
