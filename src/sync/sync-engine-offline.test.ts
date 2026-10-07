import { beforeAll, describe, expect, it } from "vitest";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { type Keyring } from "../crypto/keyring";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { ForgeError } from "../forge/errors";
import type { CommitRequest, ForgeAdapter } from "../forge/forge-adapter";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { createTestClock } from "./testing/test-clock";
import {
  WELCOME,
  advance,
  mainContent,
  settle,
} from "./testing/engine-harness";
import { createSyncEngine, type SyncEngine } from "./sync-engine";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

const START = 1_000_000;

const OFFLINE_WAIT = {
  kind: "waiting",
  reason: "offline",
  retryAt: null,
  error: null,
};

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly engine: SyncEngine;
  readonly commits: CommitRequest[];
  readonly probe: { online: boolean };
  readonly hooks: { beforeCommit: (() => void) | null };
}

function wrap(
  inner: FakeForgeAdapter,
  commits: CommitRequest[],
  hooks: Harness["hooks"],
): ForgeAdapter {
  return delegateAdapter(inner, {
    commit: (request) => {
      hooks.beforeCommit?.();
      commits.push(request);
      return inner.commit(request);
    },
  });
}

async function setup(options?: {
  readonly online?: boolean;
  readonly withProbe?: boolean;
}): Promise<Harness> {
  const clock = createTestClock(START);
  const fake = await createSampleNotesRepoAdapter();
  const commits: CommitRequest[] = [];
  const hooks: Harness["hooks"] = { beforeCommit: null };
  const adapter = wrap(fake, commits, hooks);
  const probe = { online: options?.online ?? true };
  const engine = createSyncEngine({
    adapter,
    keyring,
    clock,
    ...(options?.withProbe === false ? {} : { isOnline: () => probe.online }),
  });
  await engine.refresh();
  return { fake, clock, engine, commits, probe, hooks };
}

describe("sync engine offline", () => {
  it("reflects the probe at creation and follows setOnline", async () => {
    const h = await setup({ online: false });
    expect(h.engine.getState().online).toBe(false);

    h.probe.online = true;
    h.engine.setOnline(true);
    expect(h.engine.getState().online).toBe(true);

    h.engine.setOnline(false);
    expect(h.engine.getState().online).toBe(false);
  });

  it("treats an engine created without a probe as online", async () => {
    const h = await setup({ withProbe: false });
    expect(h.engine.getState().online).toBe(true);
  });

  it("waits without committing while offline, then saves at once when online", async () => {
    const h = await setup();
    h.engine.setOnline(false);

    h.engine.editNote(WELCOME, "offline edit");
    await advance(h, 2_000);

    expect(h.commits).toHaveLength(0);
    const state = h.engine.getState();
    expect(state.save).toEqual(OFFLINE_WAIT);
    expect(state.syncStates.stateOf([])).toEqual({
      kind: "out-of-sync",
      reason: "pending",
    });

    await advance(h, 10 * 60_000);
    expect(h.commits).toHaveLength(0);

    h.engine.setOnline(true);
    await settle(h.engine);

    expect(h.commits).toHaveLength(1);
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
    expect(h.engine.getState().syncStates.unsavedCount).toBe(0);
    expect(await mainContent(h.fake, WELCOME)).toBe("offline edit");
  });

  it("flush while offline commits nothing and reports unsaved work", async () => {
    const h = await setup({ online: false });
    h.engine.editNote(WELCOME, "flushed offline");

    expect(await h.engine.flush()).toEqual({ kind: "unsaved", count: 1 });
    expect(h.commits).toHaveLength(0);
    expect(h.engine.getState().save).toEqual(OFFLINE_WAIT);
  });

  it("going offline cancels a pending back-off retry", async () => {
    const h = await setup();
    h.fake.failNext("commit", new ForgeError("Network"));
    h.engine.editNote(WELCOME, "retried later");
    await advance(h, 2_000);
    expect(h.engine.getState().save).toMatchObject({
      kind: "waiting",
      reason: "failed",
      retryAt: h.clock.now() + 5_000,
    });
    const attempts = h.commits.length;

    h.engine.setOnline(false);
    expect(h.engine.getState().save).toEqual(OFFLINE_WAIT);

    await advance(h, 10_000);
    expect(h.commits).toHaveLength(attempts);
    expect(h.engine.getState().save).toEqual(OFFLINE_WAIT);
  });

  it("demotes to offline before saving when the probe reports offline", async () => {
    const h = await setup();
    h.engine.editNote(WELCOME, "probe offline");
    h.probe.online = false;

    await h.engine.flush();

    expect(h.commits).toHaveLength(0);
    expect(h.engine.getState().online).toBe(false);
    expect(h.engine.getState().save).toEqual(OFFLINE_WAIT);
  });

  it("a commit failing after the probe flipped offline waits offline, and later online failures start at the initial back-off", async () => {
    const h = await setup();
    h.engine.editNote(WELCOME, "failed offline");
    h.fake.failNext("commit", new ForgeError("Network"));
    h.hooks.beforeCommit = () => {
      h.probe.online = false;
    };

    await h.engine.flush();

    expect(h.commits).toHaveLength(1);
    expect(h.engine.getState().online).toBe(false);
    expect(h.engine.getState().save).toEqual(OFFLINE_WAIT);

    h.hooks.beforeCommit = null;
    h.probe.online = true;
    h.fake.failNext("commit", new ForgeError("Network"));
    h.engine.setOnline(true);
    await settle(h.engine);

    expect(h.engine.getState().save).toEqual({
      kind: "waiting",
      reason: "failed",
      retryAt: h.clock.now() + 5_000,
      error: { kind: "network" },
    });
  });
});
