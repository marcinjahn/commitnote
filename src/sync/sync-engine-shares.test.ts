import { beforeAll, describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { decryptNote, encryptNote } from "../crypto/note-cipher";
import { testKeyring } from "../crypto/testing/test-keyring";
import { ForgeError } from "../forge/errors";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { SHARES_PATH, TRAILER } from "../format/v1";
import {
  readShareIndex,
  type ShareEntry,
  type ShareIndex,
} from "../share/share-index";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { createSyncEngine, type SyncEngine } from "./sync-engine";
import {
  IDEAS,
  WELCOME,
  advance,
  okCommitCount,
  pushRemote,
  waitIdle,
} from "./testing/engine-harness";
import { createTestClock } from "./testing/test-clock";
import { findWorkingNode } from "./working-tree";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

const ENTRY: ShareEntry = {
  id: "share-1",
  locator: { provider: "gitlab", snippetId: "42" },
  linkSecret: "secret",
  password: null,
  name: "Welcome",
  label: null,
  sharedAt: "2026-01-01T00:00:00.000Z",
  note: { state: "active", path: WELCOME },
  source: null,
  updatedAt: null,
};

const REMOTE_TRASH_ID = "20260920T100000Z-1-eeeeeeee";

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly engine: SyncEngine;
}

async function openEngine(fake: FakeForgeAdapter): Promise<Harness> {
  const clock = createTestClock(1_000_000);
  const engine = createSyncEngine({ adapter: fake, keyring, clock });
  await engine.refresh();
  return { fake, clock, engine };
}

async function setup(): Promise<Harness> {
  return openEngine(await createSampleNotesRepoAdapter());
}

function isShared(engine: SyncEngine, path: NotePath): boolean {
  const node = findWorkingNode(engine.getState().workingTree!, path);
  if (node?.kind !== "note") throw new Error("expected a note");
  return node.shared;
}

async function remoteShares(fake: FakeForgeAdapter): Promise<ShareIndex> {
  const listing = await fake.listTree(await fake.getHead());
  return readShareIndex(listing, keyring, (sha) => fake.readBlob(sha));
}

async function sharesBlobSha(fake: FakeForgeAdapter): Promise<string | null> {
  const listing = await fake.listTree(await fake.getHead());
  return listing.find((entry) => entry.path === SHARES_PATH)?.sha ?? null;
}

function headMessage(fake: FakeForgeAdapter): string {
  return fake.repo.getCommit(fake.repo.getRef("main")!)!.message;
}

describe("SyncEngine shares", () => {
  it("loads a share index pushed by another device on refresh", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = createSyncEngine({
      adapter: fake,
      keyring,
      clock: createTestClock(1_000_000),
    });
    await engine.refresh();
    expect(engine.getState().synced?.shares.entries.size).toBe(0);

    await pushRemote(fake, [{ kind: "add-share", entry: ENTRY }]);
    await engine.refresh();

    const shares = engine.getState().synced?.shares;
    expect(shares?.writable).toBe(true);
    expect(shares?.entries.get("share-1")).toEqual(ENTRY);
  });
});

describe("SyncEngine.addShare", () => {
  it("commits at once without waiting for the autosave debounce", async () => {
    const h = await setup();
    const start = await h.fake.getHead();

    expect(h.engine.addShare(ENTRY)).toEqual({ ok: true });
    await waitIdle(h.engine);

    expect(okCommitCount(h.fake, start)).toBe(1);
    expect((await remoteShares(h.fake)).entries.get(ENTRY.id)).toEqual(ENTRY);
    const message = headMessage(h.fake);
    expect(message).toContain(`${TRAILER.share}: add`);
    expect(message).not.toContain(ENTRY.name);
  });

  it("marks the note shared while pending and follows a local rename", async () => {
    const h = await setup();
    h.fake.failNext("commit", new ForgeError("Network"));

    h.engine.addShare(ENTRY);
    expect(isShared(h.engine, WELCOME)).toBe(true);
    expect(isShared(h.engine, IDEAS)).toBe(false);
    expect(h.engine.getState().shares?.entries.has(ENTRY.id)).toBe(true);
    await waitIdle(h.engine);
    expect(h.engine.getState().save.kind).toBe("waiting");

    const renamed = h.engine.rename(WELCOME, "Hello");
    if (!renamed.ok) throw new Error("rename failed");
    expect(isShared(h.engine, ["Hello"])).toBe(true);

    await h.engine.flush();
    expect((await remoteShares(h.fake)).entries.get(ENTRY.id)?.note).toEqual({
      state: "active",
      path: ["Hello"],
    });
  });

  it("refuses a folder, a missing note or a note that isn't active as not found", async () => {
    const h = await setup();

    for (const note of [
      { state: "active", path: ["Projects"] },
      { state: "active", path: ["Missing"] },
      { state: "deleted" },
    ] as const) {
      expect(h.engine.addShare({ ...ENTRY, note })).toEqual({
        ok: false,
        error: { kind: "notFound" },
      });
    }
    expect(h.engine.getState().pending).toEqual([]);
  });

  it("is seen by another engine after refresh", async () => {
    const first = await setup();
    const second = await openEngine(first.fake);

    first.engine.addShare(ENTRY);
    await waitIdle(first.engine);
    await second.engine.refresh();

    expect(isShared(second.engine, WELCOME)).toBe(true);
    expect(second.engine.getState().shares?.entries.get(ENTRY.id)).toEqual(
      ENTRY,
    );
  });
});

describe("SyncEngine.removeShare", () => {
  it("commits at once and clears the shared mark", async () => {
    const h = await setup();
    h.engine.addShare(ENTRY);
    await waitIdle(h.engine);
    const start = await h.fake.getHead();

    expect(h.engine.removeShare(ENTRY.id)).toEqual({ ok: true });
    expect(isShared(h.engine, WELCOME)).toBe(false);
    await waitIdle(h.engine);

    expect(okCommitCount(h.fake, start)).toBe(1);
    expect((await remoteShares(h.fake)).entries.size).toBe(0);
    expect(headMessage(h.fake)).toContain(`${TRAILER.share}: remove`);
  });

  it("accepts an unknown id without committing anything", async () => {
    const h = await setup();
    const start = await h.fake.getHead();

    expect(h.engine.removeShare("unknown")).toEqual({ ok: true });
    expect(h.engine.getState().pending).toEqual([]);
    await advance(h, 2_000);
    expect(okCommitCount(h.fake, start)).toBe(0);
  });
});

async function rawShareEntry(
  fake: FakeForgeAdapter,
  id: string,
): Promise<Record<string, unknown>> {
  const sha = await sharesBlobSha(fake);
  const text = await decryptNote(keyring, await fake.readBlob(sha!));
  return JSON.parse(text).shares[id];
}

describe("SyncEngine.setShareLabel", () => {
  async function withShare(entry: ShareEntry = ENTRY): Promise<Harness> {
    const h = await setup();
    h.engine.addShare(entry);
    await waitIdle(h.engine);
    return h;
  }

  it("commits at once with a trailer that does not contain the label", async () => {
    const h = await withShare();
    const start = await h.fake.getHead();

    expect(h.engine.setShareLabel(ENTRY.id, "For Anna")).toEqual({ ok: true });
    expect(h.engine.getState().shares?.entries.get(ENTRY.id)?.label).toBe(
      "For Anna",
    );
    await waitIdle(h.engine);

    expect(okCommitCount(h.fake, start)).toBe(1);
    expect((await remoteShares(h.fake)).entries.get(ENTRY.id)?.label).toBe(
      "For Anna",
    );
    const message = headMessage(h.fake);
    expect(message).toContain(`${TRAILER.share}: label`);
    expect(message).not.toContain("For Anna");
  });

  it("clears a label back to none", async () => {
    const h = await withShare({ ...ENTRY, label: "For Anna" });

    expect(h.engine.setShareLabel(ENTRY.id, null)).toEqual({ ok: true });
    await waitIdle(h.engine);

    expect((await remoteShares(h.fake)).entries.get(ENTRY.id)?.label).toBeNull();
    expect(await rawShareEntry(h.fake, ENTRY.id)).not.toHaveProperty("label");
  });

  it("refuses an unknown id as not found without committing", async () => {
    const h = await withShare();

    expect(h.engine.setShareLabel("unknown", "x")).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
    expect(h.engine.getState().pending).toEqual([]);
  });

  it("does not commit when the label is unchanged", async () => {
    const h = await withShare({ ...ENTRY, label: "For Anna" });
    const start = await h.fake.getHead();

    expect(h.engine.setShareLabel(ENTRY.id, "For Anna")).toEqual({ ok: true });
    expect(h.engine.getState().pending).toEqual([]);
    await advance(h, 2_000);

    expect(okCommitCount(h.fake, start)).toBe(0);
    expect(await h.fake.getHead()).toBe(start);
  });

  it("refuses when the share index is unreadable", async () => {
    const fake = await createSampleNotesRepoAdapter();
    await fake.pushFromAnotherDevice([
      {
        kind: "upsert-text",
        path: SHARES_PATH,
        text: await encryptNote(
          keyring,
          JSON.stringify({ shares: {}, version: 2 }),
        ),
      },
    ]);
    const h = await openEngine(fake);

    expect(h.engine.setShareLabel(ENTRY.id, "x")).toEqual({
      ok: false,
      error: { kind: "sharesUnavailable" },
    });
  });

  it("is rebased over an unrelated remote commit", async () => {
    const h = await withShare();
    h.fake.failNext("commit", new ForgeError("Network"));
    h.engine.setShareLabel(ENTRY.id, "For Anna");
    await waitIdle(h.engine);
    await pushRemote(h.fake, [
      { kind: "update-note", path: IDEAS, content: "remote ideas" },
    ]);

    await advance(h, 5_000);

    expect(h.engine.getState().pending).toEqual([]);
    expect((await remoteShares(h.fake)).entries.get(ENTRY.id)?.label).toBe(
      "For Anna",
    );
  });

  it("keeps a label set elsewhere over a local update rebased on it", async () => {
    const h = await withShare();
    h.fake.failNext("commit", new ForgeError("Network"));
    h.engine.updateShare({
      ...ENTRY,
      name: "Welcome v2",
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    await waitIdle(h.engine);
    await pushRemote(h.fake, [
      { kind: "set-share-label", id: ENTRY.id, label: "From B" },
    ]);

    await advance(h, 5_000);

    expect(h.engine.getState().pending).toEqual([]);
    const entry = (await remoteShares(h.fake)).entries.get(ENTRY.id);
    expect(entry?.label).toBe("From B");
    expect(entry?.name).toBe("Welcome v2");
    expect(h.engine.getState().shares?.entries.get(ENTRY.id)?.label).toBe(
      "From B",
    );
  });

  it("resolves quietly when the remote revoked the share meanwhile", async () => {
    const h = await withShare();
    h.fake.failNext("commit", new ForgeError("Network"));
    h.engine.setShareLabel(ENTRY.id, "For Anna");
    await waitIdle(h.engine);
    await pushRemote(h.fake, [{ kind: "remove-share", id: ENTRY.id }]);

    await advance(h, 5_000);

    expect(h.engine.getState().save).toEqual({ kind: "idle" });
    expect(h.engine.getState().pending).toEqual([]);
    expect((await remoteShares(h.fake)).entries.size).toBe(0);
    expect(h.engine.getState().shares?.entries.size).toBe(0);
  });
});

describe("SyncEngine.updateShare", () => {
  const UPDATED: ShareEntry = {
    ...ENTRY,
    name: "Welcome v2",
    source: { commit: "c1", storedPath: "Welcome", blobSha: "b1" },
    updatedAt: "2026-02-02T00:00:00.000Z",
  };

  async function withShare(): Promise<Harness> {
    const h = await setup();
    h.engine.addShare(ENTRY);
    await waitIdle(h.engine);
    return h;
  }

  it("commits at once and replaces the entry in the share index", async () => {
    const h = await withShare();
    const start = await h.fake.getHead();

    expect(h.engine.updateShare(UPDATED)).toEqual({ ok: true });
    expect(h.engine.getState().shares?.entries.get(ENTRY.id)).toEqual(UPDATED);
    await waitIdle(h.engine);

    expect(okCommitCount(h.fake, start)).toBe(1);
    expect(headMessage(h.fake)).toContain(`${TRAILER.share}: update`);
    expect((await remoteShares(h.fake)).entries.get(ENTRY.id)).toEqual(UPDATED);
  });

  it("refuses an unknown id as not found without committing", async () => {
    const h = await withShare();

    expect(h.engine.updateShare({ ...UPDATED, id: "unknown" })).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
    expect(h.engine.getState().pending).toEqual([]);
  });

  it("refuses a note that isn't active or isn't a note as not found", async () => {
    const h = await withShare();

    for (const note of [
      { state: "deleted" },
      { state: "active", path: ["Projects"] },
      { state: "active", path: ["Missing"] },
    ] as const) {
      expect(h.engine.updateShare({ ...UPDATED, note })).toEqual({
        ok: false,
        error: { kind: "notFound" },
      });
    }
    expect(h.engine.getState().pending).toEqual([]);
  });

  it("does not bring back a share the remote revoked", async () => {
    const h = await withShare();
    h.fake.failNext("commit", new ForgeError("Network"));
    h.engine.updateShare(UPDATED);
    await waitIdle(h.engine);
    await pushRemote(h.fake, [{ kind: "remove-share", id: ENTRY.id }]);

    await advance(h, 5_000);

    expect(h.engine.getState().pending).toEqual([]);
    expect((await remoteShares(h.fake)).entries.size).toBe(0);
    expect(h.engine.getState().shares?.entries.size).toBe(0);
    expect(isShared(h.engine, WELCOME)).toBe(false);
  });

  it.each([
    [
      "trashed",
      { kind: "trash-note", path: WELCOME, entryId: REMOTE_TRASH_ID } as const,
      { state: "trashed", entryId: REMOTE_TRASH_ID, path: [] } as const,
    ],
    [
      "deleted",
      { kind: "delete-note", path: WELCOME } as const,
      { state: "deleted" } as const,
    ],
  ])(
    "drops the update when the remote %s the note, and keeps saving",
    async (_, remoteChange, location) => {
      const h = await withShare();
      h.fake.failNext("commit", new ForgeError("Network"));
      h.engine.updateShare(UPDATED);
      await waitIdle(h.engine);
      await pushRemote(h.fake, [remoteChange]);

      await advance(h, 5_000);

      expect(h.engine.getState().save).toEqual({ kind: "idle" });
      expect(h.engine.getState().pending).toEqual([]);
      const entry = (await remoteShares(h.fake)).entries.get(ENTRY.id);
      expect(entry?.note).toEqual(location);
      expect(entry?.updatedAt).toBeNull();

      h.engine.editNote(IDEAS, "later edit");
      await advance(h, 5_000);

      expect(h.engine.getState().save).toEqual({ kind: "idle" });
      expect(h.engine.getState().pending).toEqual([]);
    },
  );
});

describe("SyncEngine shares with an unreadable share index", () => {
  it.each([
    [
      "another keyring",
      async () =>
        encryptNote(
          await testKeyring("another passphrase"),
          JSON.stringify({ shares: {}, version: 1 }),
        ),
    ],
    [
      "a newer version",
      async () =>
        encryptNote(keyring, JSON.stringify({ shares: {}, version: 2 })),
    ],
  ])("refuses changes and never rewrites a file from %s", async (_, text) => {
    const fake = await createSampleNotesRepoAdapter();
    await fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: SHARES_PATH, text: await text() },
    ]);
    const h = await openEngine(fake);
    const before = await sharesBlobSha(fake);
    const start = await fake.getHead();

    expect(h.engine.addShare(ENTRY)).toEqual({
      ok: false,
      error: { kind: "sharesUnavailable" },
    });
    expect(h.engine.removeShare(ENTRY.id)).toEqual({
      ok: false,
      error: { kind: "sharesUnavailable" },
    });
    expect(h.engine.updateShare(ENTRY)).toEqual({
      ok: false,
      error: { kind: "sharesUnavailable" },
    });
    expect(h.engine.setShareLabel(ENTRY.id, "x")).toEqual({
      ok: false,
      error: { kind: "sharesUnavailable" },
    });

    expect(h.engine.rename(WELCOME, "Hello").ok).toBe(true);
    await h.engine.flush();
    const trashed = h.engine.delete(["Hello"]);
    expect(trashed.ok).toBe(true);
    await h.engine.flush();

    expect(okCommitCount(fake, start)).toBe(2);
    expect(await sharesBlobSha(fake)).toBe(before);
  });
});

describe("SyncEngine.addShare rebased over a remote commit", () => {
  async function addShareThenPush(
    changes: Parameters<typeof pushRemote>[1],
  ): Promise<Harness> {
    const h = await setup();
    h.fake.failNext("commit", new ForgeError("Network"));
    h.engine.addShare(ENTRY);
    await waitIdle(h.engine);
    await pushRemote(h.fake, changes);
    await advance(h, 5_000);
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
    expect(h.engine.getState().pending).toEqual([]);
    return h;
  }

  it("keeps the active path over an unrelated remote change", async () => {
    const h = await addShareThenPush([
      { kind: "update-note", path: IDEAS, content: "remote ideas" },
    ]);

    expect((await remoteShares(h.fake)).entries.get(ENTRY.id)?.note).toEqual({
      state: "active",
      path: WELCOME,
    });
    expect(isShared(h.engine, WELCOME)).toBe(true);
  });

  it("moves to the new path when the remote renamed the note", async () => {
    const h = await addShareThenPush([
      { kind: "rename-note", from: WELCOME, to: ["Hello"] },
    ]);

    expect((await remoteShares(h.fake)).entries.get(ENTRY.id)?.note).toEqual({
      state: "active",
      path: ["Hello"],
    });
    expect(isShared(h.engine, ["Hello"])).toBe(true);
  });

  it("is committed as deleted when the remote deleted the note", async () => {
    const h = await addShareThenPush([{ kind: "delete-note", path: WELCOME }]);

    expect((await remoteShares(h.fake)).entries.get(ENTRY.id)?.note).toEqual({
      state: "deleted",
    });
  });

  it("is committed as trashed when the remote trashed the note", async () => {
    const h = await addShareThenPush([
      { kind: "trash-note", path: WELCOME, entryId: REMOTE_TRASH_ID },
    ]);

    expect((await remoteShares(h.fake)).entries.get(ENTRY.id)?.note).toEqual({
      state: "trashed",
      entryId: REMOTE_TRASH_ID,
      path: [],
    });
  });
});
