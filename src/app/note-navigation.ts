import { notePathEquals, type NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import {
  decodeNotePath,
  encodeNotePath,
  isNoteFragment,
  noteFragmentOf,
  storedPathOfFragment,
} from "./note-fragment";

export type NavigationEntry =
  | { readonly kind: "note"; readonly path: NotePath }
  | { readonly kind: "draft" }
  | { readonly kind: "none" };

export interface NoteNavigationOptions {
  keyring: Keyring;
  history: Pick<History, "state" | "pushState" | "replaceState" | "back" | "go">;
  location: Pick<Location, "hash" | "pathname" | "search">;
  events: Pick<Window, "addEventListener" | "removeEventListener">;
  onPopState: (entry: NavigationEntry) => void;
  onDialogBack?: (count: number) => void;
  sessionId?: string;
}

export interface NoteNavigation {
  initial(): Promise<NavigationEntry>;
  current(): NavigationEntry;
  push(entry: NavigationEntry): void;
  replace(entry: NavigationEntry): void;
  canGoBack(): boolean;
  back(): void;
  pushDialog(): void;
  consumeDialog(): void;
  openDialogs(): number;
  dispose(): void;
}

interface Bookkeeping {
  readonly session: string;
  readonly depth: number;
}

type StoredEntry =
  | { readonly kind: "note"; readonly storedPath: string }
  | { readonly kind: "draft" }
  | { readonly kind: "none" };

interface StaleEntries {
  readonly stored: StoredEntry;
  readonly entry: NavigationEntry;
  readonly from: number;
  readonly to: number;
}

const NONE: NavigationEntry = { kind: "none" };

function entriesEqual(a: NavigationEntry, b: NavigationEntry): boolean {
  if (a.kind === "note" && b.kind === "note")
    return notePathEquals(a.path, b.path);
  return a.kind === b.kind;
}

function baseUrl(location: Pick<Location, "pathname" | "search">): string {
  return location.pathname + location.search;
}

function urlOf(
  location: Pick<Location, "pathname" | "search">,
  stored: StoredEntry,
): string {
  const base = baseUrl(location);
  return stored.kind === "note"
    ? base + noteFragmentOf(stored.storedPath)
    : base;
}

function stateOf(stored: StoredEntry, nav: Bookkeeping, dialog = false): object {
  const bookkeeping = { session: nav.session, depth: nav.depth };
  const marker = dialog ? { dialog: true } : {};
  switch (stored.kind) {
    case "note":
      return { note: stored.storedPath, ...marker, nav: bookkeeping };
    case "draft":
      return { draft: true, ...marker, nav: bookkeeping };
    case "none":
      return { ...marker, nav: bookkeeping };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function bookkeepingOf(state: unknown): Bookkeeping | null {
  if (!isRecord(state) || !isRecord(state.nav)) return null;
  const { session, depth } = state.nav;
  if (typeof session !== "string") return null;
  if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0)
    return null;
  return { session, depth };
}

export function createNoteNavigation(
  options: NoteNavigationOptions,
): NoteNavigation {
  const { keyring, history, location, events, onPopState, onDialogBack } =
    options;
  const sessionId = options.sessionId ?? crypto.randomUUID();

  let currentEntry: NavigationEntry = NONE;
  let baseDepth = 0;
  let writtenDialogs = 0;
  let openDialogs = 0;
  let pendingPushes = 0;
  let generation = 0;
  let disposed = false;
  let stale: StaleEntries | null = null;
  let arrival: ((state: unknown) => void) | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>, fallback: T): Promise<T> {
    const run = chain.then(async () => {
      if (disposed) return fallback;
      try {
        return await task();
      } catch {
        return fallback;
      }
    });
    chain = run;
    return run;
  }

  async function storedOf(entry: NavigationEntry): Promise<StoredEntry> {
    if (entry.kind !== "note") return entry;
    try {
      return {
        kind: "note",
        storedPath: await encodeNotePath(keyring, entry.path),
      };
    } catch {
      return { kind: "none" };
    }
  }

  async function decode(storedPath: string | null): Promise<NotePath | null> {
    if (storedPath === null) return null;
    try {
      return await decodeNotePath(keyring, storedPath);
    } catch {
      return null;
    }
  }

  function stamp(depth: number): Bookkeeping {
    return { session: sessionId, depth };
  }

  function ownDepthOf(state: unknown): number | null {
    const nav = bookkeepingOf(state);
    return nav !== null && nav.session === sessionId ? nav.depth : null;
  }

  function travel(move: () => void): Promise<unknown> {
    return new Promise((resolve, reject) => {
      arrival = resolve;
      try {
        move();
      } catch (error) {
        arrival = null;
        reject(error);
      }
    });
  }

  function refreshStale(depth: number): NavigationEntry | null {
    if (stale === null || depth < stale.from || depth > stale.to) return null;
    const { stored, entry } = stale;
    history.replaceState(
      stateOf(stored, stamp(depth), depth > baseDepth),
      "",
      urlOf(location, stored),
    );
    if (depth === stale.from) stale = null;
    return entry;
  }

  function landQuietly(state: unknown): void {
    const depth = ownDepthOf(state) ?? baseDepth;
    if (depth < baseDepth) baseDepth = depth;
    writtenDialogs = depth - baseDepth;
    refreshStale(depth);
  }

  function closeDialogs(count: number): void {
    const closed = Math.min(count, openDialogs);
    openDialogs -= closed;
    if (closed > 0) onDialogBack?.(closed);
  }

  async function processPopState(
    state: unknown,
    hash: string,
    arrivedAt: number,
  ): Promise<void> {
    const ownDepth = ownDepthOf(state);
    const ours = ownDepth !== null;
    const depth = ownDepth ?? 0;

    if (
      ours &&
      writtenDialogs > 0 &&
      depth >= baseDepth &&
      depth < baseDepth + writtenDialogs
    ) {
      if (disposed) return;
      const passed = baseDepth + writtenDialogs - depth;
      writtenDialogs = depth - baseDepth;
      refreshStale(depth);
      closeDialogs(passed);
      return;
    }

    let entry: NavigationEntry = NONE;
    let stored: StoredEntry = { kind: "none" };
    let undecodable = false;
    if (isRecord(state) && state.draft === true) {
      entry = { kind: "draft" };
      stored = entry;
    } else {
      const storedPath =
        isRecord(state) && typeof state.note === "string"
          ? state.note
          : storedPathOfFragment(hash);
      if (storedPath !== null || isNoteFragment(hash)) {
        const path = await decode(storedPath);
        if (path === null || storedPath === null) {
          undecodable = true;
        } else {
          entry = { kind: "note", path };
          stored = { kind: "note", storedPath };
        }
      }
    }

    if (disposed) return;
    const passed = !ours || depth < baseDepth ? writtenDialogs : 0;
    baseDepth = depth;
    writtenDialogs = 0;
    closeDialogs(passed);
    if (generation !== arrivedAt) return;

    if (undecodable) {
      history.replaceState(
        stateOf({ kind: "none" }, stamp(depth)),
        "",
        baseUrl(location),
      );
    } else if (!ours || (isRecord(state) && state.dialog === true)) {
      const url =
        stored.kind === "note"
          ? urlOf(location, stored)
          : baseUrl(location) + hash;
      history.replaceState(stateOf(stored, stamp(depth)), "", url);
    }
    if (ours) entry = refreshStale(depth) ?? entry;

    currentEntry = entry;
    onPopState(entry);
  }

  const handlePopState = (event: Event): void => {
    const state: unknown = (event as PopStateEvent).state;
    if (arrival !== null) {
      const arrived = arrival;
      arrival = null;
      arrived(state);
      return;
    }
    const hash = location.hash;
    const arrivedAt = ++generation;
    void enqueue(() => processPopState(state, hash, arrivedAt), undefined);
  };

  events.addEventListener("popstate", handlePopState);

  return {
    initial() {
      const startedAt = generation;
      const hash = location.hash;
      return enqueue(async () => {
        const storedPath = storedPathOfFragment(hash);
        const path = await decode(storedPath);
        const entry: NavigationEntry =
          path === null ? NONE : { kind: "note", path };
        if (disposed) return entry;

        const url =
          path !== null || !isNoteFragment(hash)
            ? baseUrl(location) + hash
            : baseUrl(location);
        const stored: StoredEntry =
          path !== null && storedPath !== null
            ? { kind: "note", storedPath }
            : { kind: "none" };
        baseDepth = 0;
        writtenDialogs = 0;
        history.replaceState(stateOf(stored, stamp(0)), "", url);
        if (generation === startedAt) currentEntry = entry;
        return entry;
      }, NONE);
    },

    current() {
      return currentEntry;
    },

    push(entry) {
      if (entriesEqual(entry, currentEntry)) return;
      currentEntry = entry;
      generation++;
      pendingPushes++;
      openDialogs = 0;
      void enqueue(async () => {
        try {
          const stored = await storedOf(entry);
          if (disposed) return;
          if (writtenDialogs > 0) {
            const landed = await travel(() => history.go(-writtenDialogs));
            if (disposed) return;
            landQuietly(landed);
          }
          const depth = baseDepth + writtenDialogs + 1;
          history.pushState(
            stateOf(stored, stamp(depth)),
            "",
            urlOf(location, stored),
          );
          if (stale !== null && stale.from >= depth) stale = null;
          baseDepth = depth;
          writtenDialogs = 0;
        } finally {
          pendingPushes--;
        }
      }, undefined);
    },

    replace(entry) {
      currentEntry = entry;
      generation++;
      void enqueue(async () => {
        const stored = await storedOf(entry);
        if (disposed) return;
        const depth = baseDepth + writtenDialogs;
        history.replaceState(
          stateOf(stored, stamp(depth), writtenDialogs > 0),
          "",
          urlOf(location, stored),
        );
        if (writtenDialogs > 0) {
          stale = {
            stored,
            entry,
            from: baseDepth,
            to: Math.max(
              depth - 1,
              stale?.from === baseDepth ? stale.to : 0,
            ),
          };
        }
      }, undefined);
    },

    canGoBack() {
      return baseDepth + pendingPushes > 0;
    },

    back() {
      void enqueue(async () => {
        history.back();
      }, undefined);
    },

    pushDialog() {
      openDialogs++;
      void enqueue(async () => {
        const state: unknown = history.state;
        if (ownDepthOf(state) === null || !isRecord(state)) return;
        const depth = baseDepth + writtenDialogs + 1;
        history.pushState(
          { ...state, dialog: true, nav: stamp(depth) },
          "",
          baseUrl(location) + location.hash,
        );
        writtenDialogs++;
      }, undefined);
    },

    consumeDialog() {
      if (openDialogs === 0) return;
      openDialogs--;
      void enqueue(async () => {
        if (writtenDialogs === 0) return;
        const landed = await travel(() => history.back());
        if (disposed) return;
        landQuietly(landed);
      }, undefined);
    },

    openDialogs() {
      return openDialogs;
    },

    dispose() {
      disposed = true;
      events.removeEventListener("popstate", handlePopState);
      const arrived = arrival;
      arrival = null;
      arrived?.(undefined);
    },
  };
}

export function clearNoteFragment(
  history: Pick<History, "replaceState">,
  location: Pick<Location, "hash" | "pathname" | "search">,
): void {
  if (!isNoteFragment(location.hash)) return;
  history.replaceState({}, "", baseUrl(location));
}
