import type { Argon2idFunction } from "../crypto/argon2";
import {
  ShareReadError,
  type ShareLocator,
  type ShareReaders,
} from "../forge/share-host";
import {
  envelopeNeedsPassword,
  openShare,
  ShareOpenError,
  type SharedNote,
} from "../share/share-envelope";
import { parseShareLink } from "../share/share-link";

export type ViewerErrorKind =
  | "invalid"
  | "notFound"
  | "rateLimited"
  | "network"
  | "server"
  | "damaged"
  | "unsupported";

export type ViewerState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "password";
      readonly busy: boolean;
      readonly wrongPassword: boolean;
    }
  | { readonly kind: "note"; readonly note: SharedNote }
  | {
      readonly kind: "error";
      readonly error: ViewerErrorKind;
      readonly provider: ShareLocator["provider"] | null;
      readonly retryable: boolean;
    };

export interface ViewerController {
  getState(): ViewerState;
  subscribe(listener: (state: ViewerState) => void): () => void;
  start(): Promise<void>;
  unlock(password: string): Promise<void>;
  retry(): Promise<void>;
}

export interface ViewerDeps {
  readonly hash: string;
  readonly readers: ShareReaders;
  readonly argon2id: Argon2idFunction;
  readonly supported: boolean;
}

const RETRYABLE_KINDS: ReadonlySet<ViewerErrorKind> = new Set([
  "rateLimited",
  "network",
  "server",
]);

function readErrorKind(error: unknown): ViewerErrorKind {
  return error instanceof ShareReadError ? error.kind : "server";
}

export function createViewerController(deps: ViewerDeps): ViewerController {
  let state: ViewerState = { kind: "loading" };
  let envelope: string | null = null;
  let linkSecret: string | null = null;
  const listeners = new Set<(state: ViewerState) => void>();

  function set(next: ViewerState): void {
    state = next;
    for (const listener of [...listeners]) {
      listener(state);
    }
  }

  function fail(
    error: ViewerErrorKind,
    provider: ShareLocator["provider"] | null,
  ): void {
    set({
      kind: "error",
      error,
      provider,
      retryable: RETRYABLE_KINDS.has(error),
    });
  }

  async function start(): Promise<void> {
    envelope = null;
    linkSecret = null;
    if (!deps.supported) {
      fail("unsupported", null);
      return;
    }
    const link = parseShareLink(deps.hash);
    if (link.kind === "invalid") {
      fail("invalid", null);
      return;
    }
    const { locator } = link;
    set({ kind: "loading" });

    let text: string;
    try {
      text = await deps.readers[locator.provider].read(locator);
    } catch (error) {
      fail(readErrorKind(error), locator.provider);
      return;
    }

    let needsPassword: boolean;
    try {
      needsPassword = envelopeNeedsPassword(text);
    } catch {
      fail("damaged", locator.provider);
      return;
    }
    envelope = text;
    linkSecret = link.linkSecret;
    if (needsPassword) {
      set({ kind: "password", busy: false, wrongPassword: false });
      return;
    }
    try {
      const note = await openShare(
        text,
        link.linkSecret,
        undefined,
        deps.argon2id,
      );
      set({ kind: "note", note });
    } catch {
      fail("damaged", locator.provider);
    }
  }

  async function unlock(password: string): Promise<void> {
    if (
      state.kind !== "password" ||
      state.busy ||
      password === "" ||
      envelope === null ||
      linkSecret === null
    ) {
      return;
    }
    set({ kind: "password", busy: true, wrongPassword: state.wrongPassword });
    const provider = parseProvider();
    try {
      const note = await openShare(
        envelope,
        linkSecret,
        password,
        deps.argon2id,
      );
      set({ kind: "note", note });
    } catch (error) {
      if (
        error instanceof ShareOpenError &&
        (error.kind === "wrongPassword" || error.kind === "passwordRequired")
      ) {
        set({ kind: "password", busy: false, wrongPassword: true });
      } else {
        fail("damaged", provider);
      }
    }
  }

  function parseProvider(): ShareLocator["provider"] | null {
    const link = parseShareLink(deps.hash);
    return link.kind === "valid" ? link.locator.provider : null;
  }

  async function retry(): Promise<void> {
    if (state.kind === "error" && state.retryable) {
      await start();
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    unlock,
    retry,
  };
}
