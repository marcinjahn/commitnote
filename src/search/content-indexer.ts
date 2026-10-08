import { isForgeError } from "../forge/errors";
import type { Clock } from "../sync/clock";
import type { SearchSource } from "../sync/search-source";
import type { SyncEngine, SyncEngineState } from "../sync/sync-engine";
import type { IndexerEnvironment } from "./indexer-environment";
import { createReadPacer } from "./read-pacer";
import { indexContent, type IndexedContent } from "./search-text";
import {
  INDEX_BYTES_PER_CHAR,
  INDEX_MEMORY_CAP_BYTES,
  INDEXER_CONCURRENCY,
  RATE_LIMIT_MIN_PAUSE_MS,
  READ_ATTEMPTS,
  READ_RETRY_BASE_MS,
  SOURCE_REFRESH_THROTTLE_MS,
} from "./search-tuning";

export type IndexStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "indexing"; readonly done: number; readonly total: number }
  | { readonly kind: "paused"; readonly resumeAt: number }
  | { readonly kind: "offline" }
  | {
      readonly kind: "limited";
      readonly covered: number;
      readonly total: number;
    }
  | { readonly kind: "complete" };

export interface IndexerState {
  readonly status: IndexStatus;
  readonly unreadable: number;
}

export interface ContentIndexer {
  open(): void;
  close(): void;
  sources(): readonly SearchSource[];
  contentFor(source: SearchSource): IndexedContent | undefined;
  getState(): IndexerState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

type TrackedState = Pick<
  SyncEngineState,
  "workingTree" | "pending" | "inFlight" | "conflicts" | "openNote"
>;

const IDLE_STATE: IndexerState = { status: { kind: "idle" }, unreadable: 0 };

function sourceKey(source: SearchSource): string {
  return source.content.kind === "blob"
    ? source.content.blobSha
    : "local:" + JSON.stringify(source.path);
}

function sizeOf(content: IndexedContent): number {
  return content.text.length * INDEX_BYTES_PER_CHAR;
}

function sameTracked(a: TrackedState, b: TrackedState): boolean {
  return (
    a.workingTree === b.workingTree &&
    a.pending === b.pending &&
    a.inFlight === b.inFlight &&
    a.conflicts === b.conflicts &&
    a.openNote === b.openNote
  );
}

function sameStatus(a: IndexStatus, b: IndexStatus): boolean {
  switch (a.kind) {
    case "indexing":
      return b.kind === "indexing" && a.done === b.done && a.total === b.total;
    case "paused":
      return b.kind === "paused" && a.resumeAt === b.resumeAt;
    case "limited":
      return (
        b.kind === "limited" && a.covered === b.covered && a.total === b.total
      );
    default:
      return a.kind === b.kind;
  }
}

export function createContentIndexer(deps: {
  readonly engine: Pick<
    SyncEngine,
    "getState" | "subscribe" | "searchSources" | "readNoteText"
  >;
  readonly clock: Clock;
  readonly environment: IndexerEnvironment;
}): ContentIndexer {
  const { engine, clock, environment } = deps;
  const pacer = createReadPacer(clock);
  const listeners = new Set<() => void>();
  const timers = new Set<unknown>();

  const index = new Map<string, IndexedContent>();
  let indexBytes = 0;
  let currentSources: readonly SearchSource[] = [];
  let currentShas = new Set<string>();
  let queue: string[] = [];
  const reading = new Set<string>();
  const retrying = new Set<string>();
  const attempts = new Map<string, number>();
  const unreadable = new Set<string>();
  const skipped = new Set<string>();

  let generation = 0;
  let disposed = false;
  let everOpened = false;
  let isOpen = false;
  let firstRunDone = false;
  let stopped = false;
  let limitedBy: { readonly sha: string; readonly bytes: number } | null = null;
  let pausedUntil: number | null = null;
  let pauseTimer: unknown = undefined;
  let throttleTimer: unknown = undefined;
  let trailingRecompute = false;
  let tracked: TrackedState | null = null;
  let state: IndexerState = IDLE_STATE;

  function schedule(callback: () => void, ms: number): unknown {
    const handle = clock.setTimeout(() => {
      timers.delete(handle);
      callback();
    }, ms);
    timers.add(handle);
    return handle;
  }

  function cancel(handle: unknown): void {
    if (handle === undefined) return;
    clock.clearTimeout(handle);
    timers.delete(handle);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => schedule(resolve, ms));
  }

  function setEntry(key: string, content: IndexedContent): void {
    const previous = index.get(key);
    if (previous !== undefined) indexBytes -= sizeOf(previous);
    index.set(key, content);
    indexBytes += sizeOf(content);
  }

  function deleteEntry(key: string): void {
    const previous = index.get(key);
    if (previous === undefined) return;
    indexBytes -= sizeOf(previous);
    index.delete(key);
  }

  function computeStatus(): IndexStatus {
    if (!everOpened || stopped) return { kind: "idle" };
    const total = currentSources.length;
    let covered = 0;
    let done = 0;
    for (const source of currentSources) {
      const key = sourceKey(source);
      if (index.has(key)) {
        covered++;
        done++;
      } else if (unreadable.has(key) || skipped.has(key)) {
        done++;
      }
    }
    if (limitedBy !== null) return { kind: "limited", covered, total };
    if (done === total) return { kind: "complete" };
    if (pausedUntil !== null) return { kind: "paused", resumeAt: pausedUntil };
    if (!environment.isOnline()) return { kind: "offline" };
    return { kind: "indexing", done, total };
  }

  function countUnreadable(): number {
    let count = 0;
    for (const sha of unreadable) if (currentShas.has(sha)) count++;
    return count;
  }

  function changed(): void {
    if (disposed) return;
    const status = computeStatus();
    if (status.kind === "complete" || status.kind === "limited") {
      firstRunDone = true;
    }
    const unreadableCount = countUnreadable();
    if (
      !sameStatus(status, state.status) ||
      unreadableCount !== state.unreadable
    ) {
      state = { status, unreadable: unreadableCount };
    }
    for (const listener of [...listeners]) listener();
  }

  function canStartRead(): boolean {
    return (
      !disposed &&
      everOpened &&
      !stopped &&
      limitedBy === null &&
      pausedUntil === null &&
      (isOpen || !firstRunDone) &&
      !environment.isHidden() &&
      environment.isOnline()
    );
  }

  function wanted(sha: string): boolean {
    return (
      currentShas.has(sha) &&
      !index.has(sha) &&
      !unreadable.has(sha) &&
      !skipped.has(sha)
    );
  }

  function pump(): void {
    while (reading.size < INDEXER_CONCURRENCY && canStartRead()) {
      const sha = queue.shift();
      if (sha === undefined) return;
      if (!wanted(sha) || reading.has(sha) || retrying.has(sha)) continue;
      reading.add(sha);
      void runRead(sha, generation).catch(() => undefined);
    }
  }

  function requeueFront(sha: string): void {
    if (!queue.includes(sha)) queue.unshift(sha);
  }

  async function runRead(sha: string, readGeneration: number): Promise<void> {
    for (;;) {
      if (readGeneration !== generation) return;
      if (!canStartRead()) {
        reading.delete(sha);
        requeueFront(sha);
        return;
      }
      const wait = pacer.availableAt() - clock.now();
      if (wait <= 0) break;
      await sleep(wait);
    }
    pacer.record();

    let text: string;
    try {
      text = await engine.readNoteText(sha);
    } catch (error) {
      if (readGeneration !== generation) return;
      reading.delete(sha);
      handleReadError(sha, error);
      changed();
      pump();
      return;
    }
    if (readGeneration !== generation) return;
    reading.delete(sha);
    attempts.delete(sha);
    if (wanted(sha)) store(sha, text);
    changed();
    pump();
  }

  function store(sha: string, text: string): void {
    const bytes = text.length * INDEX_BYTES_PER_CHAR;
    if (indexBytes + bytes > INDEX_MEMORY_CAP_BYTES) {
      limitedBy = { sha, bytes };
      requeueFront(sha);
      return;
    }
    setEntry(sha, indexContent(text));
  }

  function handleReadError(sha: string, error: unknown): void {
    if (!isForgeError(error)) {
      attempts.delete(sha);
      unreadable.add(sha);
      return;
    }
    switch (error.kind) {
      case "RateLimited": {
        const resumeAt =
          clock.now() +
          Math.max(error.retryAfterMs ?? 0, RATE_LIMIT_MIN_PAUSE_MS);
        if (pausedUntil === null || resumeAt > pausedUntil) {
          pausedUntil = resumeAt;
          cancel(pauseTimer);
          pauseTimer = schedule(() => {
            pauseTimer = undefined;
            pausedUntil = null;
            changed();
            pump();
          }, resumeAt - clock.now());
        }
        requeueFront(sha);
        return;
      }
      case "Network":
      case "Server": {
        const attempt = (attempts.get(sha) ?? 0) + 1;
        if (attempt >= READ_ATTEMPTS) {
          attempts.delete(sha);
          unreadable.add(sha);
          return;
        }
        attempts.set(sha, attempt);
        retrying.add(sha);
        const retryGeneration = generation;
        schedule(
          () => {
            if (retryGeneration !== generation) return;
            retrying.delete(sha);
            if (wanted(sha)) requeueFront(sha);
            changed();
            pump();
          },
          READ_RETRY_BASE_MS * 2 ** (attempt - 1),
        );
        return;
      }
      case "NotFound":
        attempts.delete(sha);
        skipped.add(sha);
        return;
      case "Unauthorized":
      case "Forbidden":
        stopped = true;
        requeueFront(sha);
        return;
      default:
        attempts.delete(sha);
        unreadable.add(sha);
    }
  }

  function snapshot(engineState: SyncEngineState): TrackedState {
    return {
      workingTree: engineState.workingTree,
      pending: engineState.pending,
      inFlight: engineState.inFlight,
      conflicts: engineState.conflicts,
      openNote: engineState.openNote,
    };
  }

  function recompute(): void {
    tracked = snapshot(engine.getState());
    currentSources = engine.searchSources();

    const keys = new Set<string>();
    const shas = new Set<string>();
    const missing: string[] = [];
    for (const source of currentSources) {
      const key = sourceKey(source);
      keys.add(key);
      if (source.content.kind === "local") {
        const existing = index.get(key);
        if (existing === undefined || existing.text !== source.content.text) {
          setEntry(key, indexContent(source.content.text));
        }
      } else if (!shas.has(key)) {
        shas.add(key);
        missing.push(key);
      }
    }
    for (const key of [...index.keys()]) {
      if (!keys.has(key)) deleteEntry(key);
    }
    currentShas = shas;
    queue = missing.filter(
      (sha) => wanted(sha) && !reading.has(sha) && !retrying.has(sha),
    );

    if (
      limitedBy !== null &&
      (!currentShas.has(limitedBy.sha) ||
        indexBytes + limitedBy.bytes <= INDEX_MEMORY_CAP_BYTES)
    ) {
      limitedBy = null;
    }

    changed();
    pump();
  }

  function requestRecompute(): void {
    if (throttleTimer !== undefined) {
      trailingRecompute = true;
      return;
    }
    recompute();
    startThrottleWindow();
  }

  function startThrottleWindow(): void {
    throttleTimer = schedule(() => {
      throttleTimer = undefined;
      if (!trailingRecompute) return;
      trailingRecompute = false;
      recompute();
      startThrottleWindow();
    }, SOURCE_REFRESH_THROTTLE_MS);
  }

  function stopThrottle(): void {
    cancel(throttleTimer);
    throttleTimer = undefined;
    trailingRecompute = false;
  }

  const unsubscribeEngine = engine.subscribe(() => {
    if (disposed || !isOpen || tracked === null) return;
    if (sameTracked(tracked, snapshot(engine.getState()))) return;
    requestRecompute();
  });

  const unsubscribeEnvironment = environment.subscribe(() => {
    if (disposed || !everOpened) return;
    changed();
    pump();
  });

  return {
    open(): void {
      if (disposed) return;
      everOpened = true;
      isOpen = true;
      stopped = false;
      unreadable.clear();
      skipped.clear();
      stopThrottle();
      recompute();
    },
    close(): void {
      if (disposed) return;
      isOpen = false;
      stopThrottle();
    },
    sources(): readonly SearchSource[] {
      return currentSources;
    },
    contentFor(source: SearchSource): IndexedContent | undefined {
      return index.get(sourceKey(source));
    },
    getState(): IndexerState {
      return state;
    },
    subscribe(listener: () => void): () => void {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      generation++;
      for (const handle of timers) clock.clearTimeout(handle);
      timers.clear();
      pauseTimer = undefined;
      throttleTimer = undefined;
      index.clear();
      indexBytes = 0;
      queue = [];
      reading.clear();
      retrying.clear();
      attempts.clear();
      unreadable.clear();
      skipped.clear();
      currentSources = [];
      currentShas = new Set();
      state = IDLE_STATE;
      unsubscribeEngine();
      unsubscribeEnvironment();
      listeners.clear();
    },
  };
}
