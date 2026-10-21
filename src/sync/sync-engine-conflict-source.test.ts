import { beforeAll, describe, expect, it, vi } from "vitest";
import { encodeDeviceTrailer } from "../changes/device-trailer";
import type { Keyring } from "../crypto/keyring";
import { ForgeError } from "../forge/errors";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import type { CommitSummary, ListCommitsRequest } from "../forge/forge-adapter";
import { TRAILER } from "../format/v1";
import { CONFLICT_MARKER_PREFIX } from "../merge/merge-text";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { findNode } from "../tree/note-tree";
import {
  createSyncEngine,
  type HeldConflict,
  type SyncEngine,
} from "./sync-engine";
import {
  WELCOME,
  drainAsync,
  heldWelcomeConflict,
  mainTree,
  pushRemote,
  replaceLine,
  waitIdle,
} from "./testing/engine-harness";
import { createTestClock } from "./testing/test-clock";

const DEVICE = "Desk PC";
const MINE_LINE = `${CONFLICT_MARKER_PREFIX.mine} This device · ${DEVICE}`;

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

type ListCommits = (request: ListCommitsRequest) => Promise<CommitSummary[]>;

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly engine: SyncEngine;
  readonly listCommitsCalls: ListCommitsRequest[];
  overrideListCommits(impl: ListCommits): void;
  // Makes only the next listCommits call wait until the returned release is called.
  gateNextListCommits(): () => void;
}

async function setup(): Promise<Harness> {
  const fake = await createSampleNotesRepoAdapter();
  const listCommitsCalls: ListCommitsRequest[] = [];
  let override: ListCommits | null = null;
  let nextGate: Promise<void> | null = null;
  const engine = createSyncEngine({
    adapter: delegateAdapter(fake, {
      listCommits: async (request) => {
        listCommitsCalls.push(request);
        const gate = nextGate;
        nextGate = null;
        if (gate !== null) await gate;
        return override === null
          ? fake.listCommits(request)
          : override(request);
      },
    }),
    keyring,
    clock: createTestClock(1_000_000),
    deviceName: () => DEVICE,
  });
  await engine.refresh();
  return {
    fake,
    engine,
    listCommitsCalls,
    overrideListCommits(impl) {
      override = impl;
    },
    gateNextListCommits() {
      let release!: () => void;
      nextGate = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

function welcomeConflict(engine: SyncEngine): HeldConflict {
  const [conflict] = engine.getState().conflicts;
  expect(conflict).toBeDefined();
  return conflict;
}

function linesOf(text: string): string[] {
  return text.split("\n");
}

async function settledLookups(h: Harness, calls: number): Promise<void> {
  await vi.waitFor(() => expect(h.listCommitsCalls).toHaveLength(calls), {
    timeout: 5_000,
    interval: 2,
  });
  await drainAsync();
}

async function welcomeStoredPath(fake: FakeForgeAdapter): Promise<string> {
  const node = findNode(await mainTree(fake), WELCOME);
  if (node?.kind !== "note") throw new Error("expected Welcome");
  return node.storedPath;
}

async function pushSecondRemoteEdit(
  h: Harness,
  theirs: string,
  deviceName: string,
): Promise<void> {
  await pushRemote(
    h.fake,
    [
      {
        kind: "update-note",
        path: WELCOME,
        content: replaceLine(theirs, "- First bullet", "- First!"),
      },
    ],
    deviceName,
  );
}

describe("conflict source lookup", () => {
  it("labels the merged text with the device that made the remote edit", async () => {
    const h = await setup();
    const { remoteHead } = await heldWelcomeConflict(h, "Pixel app");

    await vi.waitFor(() =>
      expect(welcomeConflict(h.engine).theirsDevice).toBe("Pixel app"),
    );
    await settledLookups(h, 1);

    const conflict = welcomeConflict(h.engine);
    expect(linesOf(conflict.merged)).toContain(MINE_LINE);
    expect(linesOf(conflict.merged)).toContain(
      `${CONFLICT_MARKER_PREFIX.theirs} Other device · Pixel app`,
    );
    expect(conflict.editing).toBeNull();
    expect(h.listCommitsCalls).toEqual([
      { from: remoteHead, path: await welcomeStoredPath(h.fake), limit: 1 },
    ]);
  });

  it("leaves the source unknown and the markers plain when the commit has no device trailer", async () => {
    const h = await setup();
    await heldWelcomeConflict(h);
    await settledLookups(h, 1);

    const conflict = welcomeConflict(h.engine);
    expect(conflict.theirsDevice).toBeNull();
    expect(linesOf(conflict.merged)).toContain(MINE_LINE);
    expect(linesOf(conflict.merged)).toContain(
      `${CONFLICT_MARKER_PREFIX.theirs} Other device`,
    );
    expect(h.engine.getState().syncStates.stateOf(WELCOME)).toEqual({
      kind: "out-of-sync",
      reason: "conflict",
    });
  });

  it("leaves the source unknown when the trailer is encrypted with another key", async () => {
    const h = await setup();
    const otherKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const foreign = await encodeDeviceTrailer("Pixel app", otherKey);
    h.overrideListCommits(async (request) =>
      (await h.fake.listCommits(request)).map((commit) => ({
        ...commit,
        message: commit.message.replace(
          new RegExp(`${TRAILER.device}: .*`),
          `${TRAILER.device}: ${foreign}`,
        ),
      })),
    );

    await heldWelcomeConflict(h, "Pixel app");
    await settledLookups(h, 1);

    expect(welcomeConflict(h.engine).theirsDevice).toBeNull();
  });

  it("holds the conflict with an unknown source when the lookup fails, without touching the sync state", async () => {
    const h = await setup();
    h.overrideListCommits(() =>
      Promise.reject(new ForgeError("Network", { message: "offline" })),
    );

    await heldWelcomeConflict(h, "Pixel app");
    await settledLookups(h, 1);

    const state = h.engine.getState();
    expect(welcomeConflict(h.engine).theirsDevice).toBeNull();
    expect(state.save).toEqual({ kind: "idle" });
    expect(state.refresh.lastError).toBeNull();
    expect(state.syncStates.stateOf(WELCOME)).toEqual({
      kind: "out-of-sync",
      reason: "conflict",
    });
  });

  it("looks the source up again when the remote edits the conflicted note again", async () => {
    const h = await setup();
    const { theirs } = await heldWelcomeConflict(h, "Pixel app");
    await vi.waitFor(() =>
      expect(welcomeConflict(h.engine).theirsDevice).toBe("Pixel app"),
    );

    await pushSecondRemoteEdit(h, theirs, "Work laptop");
    await h.engine.refresh();
    await waitIdle(h.engine);

    await vi.waitFor(() =>
      expect(welcomeConflict(h.engine).theirsDevice).toBe("Work laptop"),
    );
    await settledLookups(h, 2);
    expect(linesOf(welcomeConflict(h.engine).merged)).toContain(
      `${CONFLICT_MARKER_PREFIX.theirs} Other device · Work laptop`,
    );
  });

  it("records a late source without changing the merge being edited", async () => {
    const h = await setup();
    const release = h.gateNextListCommits();
    await heldWelcomeConflict(h, "Pixel app");
    h.engine.resolveConflict(WELCOME, "editMerged");
    const editing = welcomeConflict(h.engine).editing;
    expect(editing).not.toBeNull();

    release();
    await vi.waitFor(() =>
      expect(welcomeConflict(h.engine).theirsDevice).toBe("Pixel app"),
    );

    expect(welcomeConflict(h.engine).editing).toBe(editing);
  });

  it("ignores a lookup result for a remote version the conflict no longer holds", async () => {
    const h = await setup();
    const release = h.gateNextListCommits();
    const { theirs } = await heldWelcomeConflict(h, "Pixel app");

    await pushSecondRemoteEdit(h, theirs, "Work laptop");
    await h.engine.refresh();
    await waitIdle(h.engine);
    await vi.waitFor(() =>
      expect(welcomeConflict(h.engine).theirsDevice).toBe("Work laptop"),
    );

    release();
    await settledLookups(h, 2);

    expect(welcomeConflict(h.engine).theirsDevice).toBe("Work laptop");
    expect(linesOf(welcomeConflict(h.engine).merged)).toContain(
      `${CONFLICT_MARKER_PREFIX.theirs} Other device · Work laptop`,
    );
  });
});
