import type { CommitFileChange } from "../forge/forge-adapter";
import { gitBlobSha } from "../forge/git-blob-sha";
import type { RepoCoordinates } from "../forge/repo-coordinates";
import type { Clock } from "../sync/clock";
import type { BlobStore } from "./blob-store";

export function repoKeyOf(coordinates: RepoCoordinates): string {
  return `${coordinates.forge}:${coordinates.owner}/${coordinates.repo}`;
}

export interface BlobCache {
  read(blobSha: string): Promise<string | null>;
  fill(blobSha: string, text: string): void;
  fillCommit(changes: readonly CommitFileChange[]): void;
  purge(referenced: ReadonlySet<string>, snapshot: number): Promise<void>;
  dispose(): Promise<void>;
  clear(): Promise<void>;
}

interface PendingWrite {
  readonly text: string;
}

export function createBlobCache(options: {
  readonly store: BlobStore;
  readonly repoKey: string;
  readonly clock: Pick<Clock, "now">;
}): BlobCache {
  const { store, repoKey, clock } = options;
  const pendingFills = new Map<string, PendingWrite>();
  const hashing = new Set<Promise<void>>();
  const inFlight = new Set<Promise<void>>();
  let purging: Promise<void> | null = null;
  let closing = false;
  let shutdownPromise: Promise<void> | null = null;

  function track(promise: Promise<void>): void {
    inFlight.add(promise);
    void promise.then(() => inFlight.delete(promise));
  }

  function startFill(blobSha: string, text: string): void {
    try {
      const write: PendingWrite = { text };
      pendingFills.set(blobSha, write);
      const settled = store
        .put(repoKey, blobSha, text, clock.now())
        .catch(() => undefined)
        .then(() => {
          if (pendingFills.get(blobSha) === write) pendingFills.delete(blobSha);
        });
      track(settled);
    } catch {
      pendingFills.delete(blobSha);
    }
  }

  function shutdown(removeEntries: boolean): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    closing = true;
    shutdownPromise = (async () => {
      // Settling fills can start new ones (commit hashing), so drain until empty.
      while (inFlight.size > 0) await Promise.all([...inFlight]);
      if (removeEntries) await store.deleteRepo(repoKey);
      store.close();
    })().catch(() => undefined);
    return shutdownPromise;
  }

  return {
    async read(blobSha) {
      if (closing) return null;
      try {
        await Promise.all([...hashing]);
        const pending = pendingFills.get(blobSha);
        if (pending) return pending.text;
        const entry = await store.get(repoKey, blobSha);
        if (!entry) return null;
        if ((await gitBlobSha(entry.text)) === blobSha) {
          void store
            .touch(repoKey, blobSha, clock.now())
            .catch(() => undefined);
          return entry.text;
        }
        void store.delete(repoKey, blobSha).catch(() => undefined);
        return null;
      } catch {
        return null;
      }
    },

    fill(blobSha, text) {
      if (closing) return;
      startFill(blobSha, text);
    },

    fillCommit(changes) {
      if (closing) return;
      for (const change of changes) {
        if (change.kind !== "upsert-text") continue;
        const { text } = change;
        const hashed = gitBlobSha(text).then(
          (blobSha) => startFill(blobSha, text),
          () => undefined,
        );
        hashing.add(hashed);
        track(hashed);
        void hashed.then(() => hashing.delete(hashed));
      }
    },

    purge(referenced, snapshot) {
      if (closing) return Promise.resolve();
      if (purging) return purging;
      const keep = new Set(referenced);
      for (const blobSha of pendingFills.keys()) keep.add(blobSha);
      const run: Promise<void> = store
        .deleteUnreferenced(repoKey, keep, snapshot)
        .catch(() => undefined)
        .then(() => {
          if (purging === run) purging = null;
        });
      purging = run;
      track(run);
      return run;
    },

    dispose() {
      return shutdown(false);
    },

    clear() {
      return shutdown(true);
    },
  };
}
