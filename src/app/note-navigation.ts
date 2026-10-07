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
  history: Pick<History, "state" | "pushState" | "replaceState" | "back">;
  location: Pick<Location, "hash" | "pathname" | "search">;
  events: Pick<Window, "addEventListener" | "removeEventListener">;
  onPopState: (entry: NavigationEntry) => void;
  sessionId?: string;
}

export interface NoteNavigation {
  initial(): Promise<NavigationEntry>;
  current(): NavigationEntry;
  push(entry: NavigationEntry): void;
  replace(entry: NavigationEntry): void;
  canGoBack(): boolean;
  back(): void;
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

function stateOf(stored: StoredEntry, nav: Bookkeeping): object {
  const bookkeeping = { session: nav.session, depth: nav.depth };
  switch (stored.kind) {
    case "note":
      return { note: stored.storedPath, nav: bookkeeping };
    case "draft":
      return { draft: true, nav: bookkeeping };
    case "none":
      return { nav: bookkeeping };
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
  const { keyring, history, location, events, onPopState } = options;
  const sessionId = options.sessionId ?? crypto.randomUUID();

  let currentEntry: NavigationEntry = NONE;
  let writtenDepth = 0;
  let pendingPushes = 0;
  let generation = 0;
  let disposed = false;
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

  async function processPopState(
    state: unknown,
    hash: string,
    arrivedAt: number,
  ): Promise<void> {
    const nav = bookkeepingOf(state);
    const ours = nav !== null && nav.session === sessionId;
    const depth = ours ? nav.depth : 0;

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
    writtenDepth = depth;
    if (generation !== arrivedAt) return;

    if (undecodable) {
      history.replaceState(
        stateOf({ kind: "none" }, stamp(depth)),
        "",
        baseUrl(location),
      );
    } else if (!ours) {
      const url =
        stored.kind === "note"
          ? urlOf(location, stored)
          : baseUrl(location) + hash;
      history.replaceState(stateOf(stored, stamp(depth)), "", url);
    }

    currentEntry = entry;
    onPopState(entry);
  }

  const handlePopState = (event: Event): void => {
    const state: unknown = (event as PopStateEvent).state;
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
        writtenDepth = 0;
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
      void enqueue(async () => {
        try {
          const stored = await storedOf(entry);
          if (disposed) return;
          const depth = writtenDepth + 1;
          history.pushState(
            stateOf(stored, stamp(depth)),
            "",
            urlOf(location, stored),
          );
          writtenDepth = depth;
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
        history.replaceState(
          stateOf(stored, stamp(writtenDepth)),
          "",
          urlOf(location, stored),
        );
      }, undefined);
    },

    canGoBack() {
      return writtenDepth + pendingPushes > 0;
    },

    back() {
      void enqueue(async () => {
        history.back();
      }, undefined);
    },

    dispose() {
      disposed = true;
      events.removeEventListener("popstate", handlePopState);
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
