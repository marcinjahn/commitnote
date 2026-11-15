import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { ForgeError, type ForgeErrorKind } from "../forge/errors";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import type { ForgeAdapter } from "../forge/forge-adapter";
import type { Session } from "../session/session";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { resumeRemembered } from "./resume-remembered";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

function rememberedSession(): Session {
  return {
    repoUrl: "https://github.com/alice/notes",
    coordinates: { forge: "github", owner: "alice", repo: "notes" },
    accessToken: "token",
    keyring,
  };
}

function setup(
  session: Session | null,
  adapter: ForgeAdapter,
  startFromCache?: (
    session: Session,
    adapter: ForgeAdapter,
  ) => Promise<boolean>,
) {
  const clearAfterFailure = vi.fn((_session: Session | null) =>
    Promise.resolve(),
  );
  const onSessionLoaded = vi.fn((_session: Session) => Promise.resolve());
  const run = () =>
    resumeRemembered({
      store: { loadRememberedSession: () => Promise.resolve(session) },
      loginDeps: { createAdapter: () => adapter },
      onSessionLoaded,
      startFromCache,
      clearAfterFailure,
    });
  return { run, clearAfterFailure, onSessionLoaded };
}

async function failingAdapter(kind: ForgeErrorKind): Promise<ForgeAdapter> {
  return delegateAdapter(await createSampleNotesRepoAdapter(), {
    inspect: () => Promise.reject(new ForgeError(kind)),
  });
}

describe("resumeRemembered", () => {
  it("clears leftover data and reports none without a remembered session", async () => {
    const h = setup(null, await createSampleNotesRepoAdapter());

    expect(await h.run()).toEqual({ kind: "none" });
    expect(h.clearAfterFailure).toHaveBeenCalledExactlyOnceWith(null);
    expect(h.onSessionLoaded).not.toHaveBeenCalled();
  });

  it("logs in with the remembered session and the current head", async () => {
    const session = rememberedSession();
    const adapter = await createSampleNotesRepoAdapter();
    const h = setup(session, adapter);

    const result = await h.run();

    expect(result).toEqual({
      kind: "loggedIn",
      session,
      adapter,
      head: await adapter.getHead(),
    });
    expect(h.onSessionLoaded).toHaveBeenCalledExactlyOnceWith(session);
    expect(h.clearAfterFailure).not.toHaveBeenCalled();
  });

  it("keeps the remembered data after a transient failure", async () => {
    const h = setup(rememberedSession(), await failingAdapter("Network"));

    expect(await h.run()).toEqual({
      kind: "failed",
      error: { kind: "network" },
      transient: true,
    });
    expect(h.clearAfterFailure).not.toHaveBeenCalled();
  });

  it("clears the remembered data after a failure that will not go away", async () => {
    const session = rememberedSession();
    const h = setup(session, await failingAdapter("Unauthorized"));

    expect(await h.run()).toEqual({
      kind: "failed",
      error: { kind: "unauthorized" },
      transient: false,
    });
    expect(h.clearAfterFailure).toHaveBeenCalledExactlyOnceWith(session);
  });

  it("starts from the cache without checking the session with the forge", async () => {
    const session = rememberedSession();
    const inspect = vi.fn(() => Promise.reject(new ForgeError("Network")));
    const adapter = delegateAdapter(await createSampleNotesRepoAdapter(), {
      inspect,
    });
    const startFromCache = vi.fn(() => Promise.resolve(true));
    const h = setup(session, adapter, startFromCache);

    expect(await h.run()).toEqual({ kind: "startedFromCache" });
    expect(startFromCache).toHaveBeenCalledExactlyOnceWith(session, adapter);
    expect(inspect).not.toHaveBeenCalled();
    expect(h.clearAfterFailure).not.toHaveBeenCalled();
  });

  it("checks the session with the forge when nothing is cached", async () => {
    const adapter = await createSampleNotesRepoAdapter();
    const h = setup(rememberedSession(), adapter, () => Promise.resolve(false));

    expect(await h.run()).toMatchObject({ kind: "loggedIn", adapter });
  });
});
