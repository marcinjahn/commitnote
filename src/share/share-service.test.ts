import { beforeAll, describe, expect, it } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { argon2idDirect } from "../crypto/argon2";
import { encryptNote } from "../crypto/note-cipher";
import { ForgeError } from "../forge/errors";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import {
  createFakeShareReaders,
  createFakeShareStore,
  type FakeShareStore,
} from "../forge/fake/fake-share-store";
import { SHARES_PATH } from "../format/v1";
import { createNoteHistory } from "../history/note-history";
import { createRateBudget } from "../sync/rate-budget";
import { createSyncEngine, type SyncEngine } from "../sync/sync-engine";
import {
  IDEAS,
  WELCOME,
  mainContent,
  pushRemote,
  settle,
} from "../sync/testing/engine-harness";
import { createTestClock } from "../sync/testing/test-clock";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { openShare, ShareOpenError } from "./share-envelope";
import { parseShareLink } from "./share-link";
import {
  createShareService,
  shareErrorOf,
  type ShareService,
} from "./share-service";

const LINK_BASE = "https://notes.example/app";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly store: FakeShareStore;
  readonly engine: SyncEngine;
  readonly service: ShareService;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly budget: ReturnType<typeof createRateBudget>;
}

async function setup(fake?: FakeForgeAdapter, store?: FakeShareStore) {
  const shares = store ?? createFakeShareStore();
  const adapter =
    fake ??
    (await createSampleNotesRepoAdapter({
      shares: { store: shares, provider: "github" },
    }));
  const clock = createTestClock(1_000_000);
  const budget = createRateBudget(clock, adapter.limits);
  const engine = createSyncEngine({
    adapter,
    keyring,
    clock,
    rateBudget: budget,
  });
  await engine.refresh();
  const service = createShareService({
    engine,
    shareHost: adapter.shareHost,
    noteHistory: createNoteHistory({ adapter, keyring }),
    rateBudget: budget,
    clock,
    argon2id: argon2idDirect,
    linkBase: LINK_BASE,
  });
  return { fake: adapter, store: shares, engine, service, clock, budget };
}

function hostedEnvelope(h: Harness, hash: string): string {
  const parsed = parseShareLink(hash);
  if (parsed.kind !== "valid") throw new Error("invalid link");
  const envelope = h.store.read(parsed.locator);
  if (envelope === null) throw new Error("not hosted");
  return envelope;
}

function hashOf(link: string): string {
  return link.slice(LINK_BASE.length);
}

describe("createShare", () => {
  it("flushes pending edits and shares the saved text", async () => {
    const h = await setup();
    h.engine.editNote(WELCOME, "# Fresh\n\nnew text");

    const result = await h.service.createShare({ path: WELCOME, password: "" });

    if (!result.ok) throw new Error(`failed: ${result.error.kind}`);
    const saved = await mainContent(h.fake, WELCOME);
    expect(saved).toBe("# Fresh\n\nnew text");
    const parsed = parseShareLink(hashOf(result.link));
    if (parsed.kind !== "valid") throw new Error("invalid link");
    expect(parsed.locator).toEqual(result.entry.locator);
    const opened = await openShare(
      hostedEnvelope(h, hashOf(result.link)),
      parsed.linkSecret,
      undefined,
      argon2idDirect,
    );
    expect(opened.markdown).toBe(saved);
    expect(opened.name).toBe("Welcome");
    expect(result.password).toBeNull();
  });

  it("records the shared version and the entry", async () => {
    const h = await setup();
    const result = await h.service.createShare({ path: WELCOME, password: "" });
    if (!result.ok) throw new Error("failed");
    await settle(h.engine);

    const head = await h.fake.getHead();
    const listing = await h.fake.listTree(head);
    const newest = await createNoteHistory({
      adapter: h.fake,
      keyring,
    }).newestVersion(WELCOME, head);
    const file = listing.find((e) => e.sha === result.entry.source?.blobSha);
    expect(result.entry.source).toEqual({
      commit: newest.kind === "found" ? newest.version.sha : null,
      storedPath: file?.path,
      blobSha: file?.sha,
    });
    expect(h.engine.getState().shares?.entries.get(result.entry.id)).toEqual(
      result.entry,
    );
    expect(result.entry.note).toEqual({ state: "active", path: WELCOME });
  });

  it("records the note's newest version when another note changed after it", async () => {
    const h = await setup();
    const otherHead = await pushRemote(h.fake, [
      { kind: "update-note", path: IDEAS, content: "# Ideas\n\nnewer" },
    ]);
    await h.engine.refresh();
    expect(h.engine.getState().synced?.head).toBe(otherHead);

    const result = await h.service.createShare({ path: WELCOME, password: "" });

    if (!result.ok) throw new Error("failed");
    const newest = await createNoteHistory({
      adapter: h.fake,
      keyring,
    }).newestVersion(WELCOME, otherHead);
    if (newest.kind !== "found") throw new Error("no version");
    expect(newest.version.sha).not.toBe(otherHead);
    expect(result.entry.source?.commit).toBe(newest.version.sha);
  });

  it("stores the password and needs it to open", async () => {
    const h = await setup();
    const result = await h.service.createShare({
      path: WELCOME,
      password: "hunter2",
    });
    if (!result.ok) throw new Error("failed");
    expect(result.password).toBe("hunter2");
    expect(result.entry.password).toBe("hunter2");
    const hash = hashOf(result.link);
    const envelope = hostedEnvelope(h, hash);

    await expect(
      openShare(envelope, result.entry.linkSecret, undefined, argon2idDirect),
    ).rejects.toBeInstanceOf(ShareOpenError);
    const opened = await openShare(
      envelope,
      result.entry.linkSecret,
      "hunter2",
      argon2idDirect,
    );
    expect(opened.name).toBe("Welcome");
  });

  it("refuses without calling the host when the rate budget is exhausted", async () => {
    const h = await setup();
    for (let i = 0; i < h.fake.limits.perMinute; i++) h.budget.record();
    let calls = 0;
    const create = h.fake.shareHost.create;
    h.fake.shareHost.create = async (envelope) => {
      calls++;
      return create(envelope);
    };

    const result = await h.service.createShare({ path: WELCOME, password: "" });

    expect(result).toEqual({
      ok: false,
      error: { kind: "rateLimited", retryAfterMs: expect.any(Number) },
    });
    expect(calls).toBe(0);
  });

  it("maps a forbidden host to permissionMissing and adds no entry", async () => {
    const h = await setup();
    h.fake.failNext("createShare", new ForgeError("Forbidden"));

    const result = await h.service.createShare({ path: WELCOME, password: "" });

    expect(result).toEqual({
      ok: false,
      error: { kind: "permissionMissing" },
    });
    expect(h.engine.getState().shares?.entries.size).toBe(0);
  });

  it("reports sharesUnavailable for an unreadable share index", async () => {
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
    const h = await setup(fake);

    expect(
      await h.service.createShare({ path: WELCOME, password: "" }),
    ).toEqual({ ok: false, error: { kind: "sharesUnavailable" } });
  });

  it("reports notSaved for a note with a conflict", async () => {
    const h = await setup();
    const original = (await mainContent(h.fake, WELCOME)) ?? "";
    await pushRemote(h.fake, [
      {
        kind: "update-note",
        path: WELCOME,
        content: original.replace("# Welcome", "# Welcome (theirs)"),
      },
    ]);
    h.engine.editNote(WELCOME, original.replace("# Welcome", "# Welcome (mine)"));
    await h.engine.flush();
    expect(h.engine.getState().conflicts).toHaveLength(1);

    expect(
      await h.service.createShare({ path: WELCOME, password: "" }),
    ).toEqual({ ok: false, error: { kind: "notSaved" } });
  });

  it("reports notSaved for a note that does not exist", async () => {
    const h = await setup();
    expect(
      await h.service.createShare({ path: ["Nope"], password: "" }),
    ).toEqual({ ok: false, error: { kind: "notSaved" } });
  });
});

describe("updateShare", () => {
  async function shared(password = "") {
    const h = await setup();
    const created = await h.service.createShare({ path: WELCOME, password });
    if (!created.ok) throw new Error("failed");
    await settle(h.engine);
    return { h, created, hash: hashOf(created.link) };
  }

  async function openHosted(
    h: Harness,
    hash: string,
    password?: string,
  ) {
    const parsed = parseShareLink(hash);
    if (parsed.kind !== "valid") throw new Error("invalid link");
    const readers = createFakeShareReaders(h.store);
    const envelope = await readers[parsed.locator.provider].read(
      parsed.locator,
    );
    return openShare(envelope, parsed.linkSecret, password, argon2idDirect);
  }

  it("flushes pending edits and hosts them under the same link", async () => {
    const { h, created, hash } = await shared();
    h.engine.editNote(WELCOME, "# Fresh\n\nnew text");

    const result = await h.service.updateShare(created.entry.id);

    if (!result.ok) throw new Error(`failed: ${result.error.kind}`);
    expect(result.unchanged).toBe(false);
    expect((await openHosted(h, hash)).markdown).toBe("# Fresh\n\nnew text");
  });

  it("needs the same password to open the updated link", async () => {
    const { h, created, hash } = await shared("hunter2");
    h.engine.editNote(WELCOME, "# Fresh\n\nnew text");

    const result = await h.service.updateShare(created.entry.id);

    expect(result.ok).toBe(true);
    await expect(openHosted(h, hash)).rejects.toBeInstanceOf(ShareOpenError);
    expect((await openHosted(h, hash, "hunter2")).markdown).toBe(
      "# Fresh\n\nnew text",
    );
  });

  it("records the update on the entry", async () => {
    const { h, created } = await shared();
    h.engine.editNote(WELCOME, "# Fresh\n\nnew text");
    h.engine.rename(WELCOME, "Renamed");
    h.clock.advance(60_000);

    const result = await h.service.updateShare(created.entry.id);
    if (!result.ok) throw new Error(`failed: ${result.error.kind}`);
    await settle(h.engine);

    const head = await h.fake.getHead();
    const newest = await createNoteHistory({
      adapter: h.fake,
      keyring,
    }).newestVersion(["Renamed"], head);
    if (newest.kind !== "found") throw new Error("no version");
    expect(result.entry.sharedAt).toBe(created.entry.sharedAt);
    expect(result.entry.updatedAt).toBe(new Date(h.clock.now()).toISOString());
    expect(result.entry.name).toBe("Renamed");
    expect(result.entry.source?.commit).toBe(newest.version.sha);
    expect(h.engine.getState().shares?.entries.get(created.entry.id)).toEqual(
      result.entry,
    );
    const hosted = await openHosted(h, hashOf(created.link));
    expect(hosted.name).toBe("Renamed");
    expect(hosted.sharedAt).toBe(created.entry.sharedAt);
  });

  it("reports unchanged without a host request on a second update", async () => {
    const { h, created } = await shared();
    h.engine.editNote(WELCOME, "# Fresh\n\nnew text");
    const first = await h.service.updateShare(created.entry.id);
    if (!first.ok) throw new Error("failed");
    let calls = 0;
    const update = h.fake.shareHost.update;
    h.fake.shareHost.update = async (locator, envelope) => {
      calls++;
      return update(locator, envelope);
    };

    const second = await h.service.updateShare(created.entry.id);

    expect(second).toEqual({ ok: true, entry: first.entry, unchanged: true });
    expect(calls).toBe(0);
  });

  it("reports unchanged right after the share was created", async () => {
    const { h, created } = await shared();
    const result = await h.service.updateShare(created.entry.id);
    expect(result).toEqual({
      ok: true,
      entry: created.entry,
      unchanged: true,
    });
  });

  it("refuses a note with a conflict", async () => {
    const { h, created } = await shared();
    const original = (await mainContent(h.fake, WELCOME)) ?? "";
    await pushRemote(h.fake, [
      {
        kind: "update-note",
        path: WELCOME,
        content: original.replace("# Welcome", "# Welcome (theirs)"),
      },
    ]);
    h.engine.editNote(WELCOME, original.replace("# Welcome", "# Welcome (mine)"));
    await h.engine.flush();
    expect(h.engine.getState().conflicts).toHaveLength(1);

    expect(await h.service.updateShare(created.entry.id)).toEqual({
      ok: false,
      error: { kind: "notSaved" },
    });
  });

  it("refuses a draft note", async () => {
    const { h, created } = await shared();
    h.engine.createNote([], "Draft");
    const added = h.engine.addShare({
      ...created.entry,
      id: "draft-share",
      note: { state: "active", path: ["Draft"] },
    });
    if (!added.ok) throw new Error("could not add");

    expect(await h.service.updateShare("draft-share")).toEqual({
      ok: false,
      error: { kind: "notSaved" },
    });
  });

  it("refuses an unknown share", async () => {
    const h = await setup();
    expect(await h.service.updateShare("missing")).toEqual({
      ok: false,
      error: { kind: "notSaved" },
    });
  });

  it("reports sharesUnavailable for an unreadable share index", async () => {
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
    const h = await setup(fake);

    expect(await h.service.updateShare("any")).toEqual({
      ok: false,
      error: { kind: "sharesUnavailable" },
    });
  });

  it("refuses without hosting when the rate budget is exhausted", async () => {
    const { h, created, hash } = await shared();
    const before = hostedEnvelope(h, hash);
    h.engine.editNote(WELCOME, "# Fresh\n\nnew text");
    await h.engine.flush();
    for (let i = 0; i < h.fake.limits.perMinute; i++) h.budget.record();

    const result = await h.service.updateShare(created.entry.id);

    expect(result).toEqual({
      ok: false,
      error: { kind: "rateLimited", retryAfterMs: expect.any(Number) },
    });
    expect(hostedEnvelope(h, hash)).toBe(before);
  });

  it("maps a missing hosted share to shareMissing", async () => {
    const { h, created } = await shared();
    h.engine.editNote(WELCOME, "# Fresh\n\nnew text");
    h.store.delete(created.entry.locator);

    expect(await h.service.updateShare(created.entry.id)).toEqual({
      ok: false,
      error: { kind: "shareMissing" },
    });
  });

  it("keeps the entry unchanged when the host fails", async () => {
    const { h, created } = await shared();
    h.engine.editNote(WELCOME, "# Fresh\n\nnew text");
    h.fake.failNext("updateShare", new ForgeError("Network"));

    expect(await h.service.updateShare(created.entry.id)).toEqual({
      ok: false,
      error: { kind: "network" },
    });
    expect(h.engine.getState().shares?.entries.get(created.entry.id)).toEqual(
      created.entry,
    );
  });

  it("reports notSaved when the index write fails after hosting", async () => {
    const { h, created, hash } = await shared();
    h.engine.editNote(WELCOME, "# Fresh\n\nnew text");
    const service = createShareService({
      engine: {
        ...h.engine,
        updateShare: () => ({ ok: false, error: { kind: "notFound" } }),
      },
      shareHost: h.fake.shareHost,
      noteHistory: createNoteHistory({ adapter: h.fake, keyring }),
      rateBudget: h.budget,
      clock: h.clock,
      argon2id: argon2idDirect,
      linkBase: LINK_BASE,
    });

    expect(await service.updateShare(created.entry.id)).toEqual({
      ok: false,
      error: { kind: "notSaved" },
    });
    expect((await openHosted(h, hash)).markdown).toBe("# Fresh\n\nnew text");
  });
});

describe("revokeShare", () => {
  async function shared() {
    const h = await setup();
    const result = await h.service.createShare({ path: WELCOME, password: "" });
    if (!result.ok) throw new Error("failed");
    await settle(h.engine);
    return { h, entry: result.entry };
  }

  it("deletes the hosted share and the entry", async () => {
    const { h, entry } = await shared();

    expect(await h.service.revokeShare(entry.id)).toEqual({ ok: true });

    expect(h.store.read(entry.locator)).toBeNull();
    expect(h.engine.getState().shares?.entries.has(entry.id)).toBe(false);
  });

  it("keeps the entry when the delete fails", async () => {
    const { h, entry } = await shared();
    h.fake.failNext("deleteShare", new ForgeError("Network"));

    expect(await h.service.revokeShare(entry.id)).toEqual({
      ok: false,
      error: { kind: "network" },
    });

    expect(h.engine.getState().shares?.entries.has(entry.id)).toBe(true);
    expect(h.store.read(entry.locator)).not.toBeNull();
  });

  it("succeeds when the hosted copy is already gone", async () => {
    const { h, entry } = await shared();
    h.store.delete(entry.locator);

    expect(await h.service.revokeShare(entry.id)).toEqual({ ok: true });
    expect(h.engine.getState().shares?.entries.has(entry.id)).toBe(false);
  });

  it("succeeds for an unknown share", async () => {
    const h = await setup();
    expect(await h.service.revokeShare("missing")).toEqual({ ok: true });
  });
});

describe("revokeShares", () => {
  async function sharedTwice() {
    const h = await setup();
    const first = await h.service.createShare({ path: WELCOME, password: "" });
    const second = await h.service.createShare({ path: IDEAS, password: "" });
    if (!first.ok || !second.ok) throw new Error("failed");
    await settle(h.engine);
    return { h, entries: [first.entry, second.entry] };
  }

  it("revokes every share within a folder and leaves the others", async () => {
    const { h, entries } = await sharedTwice();
    const [welcome, ideas] = entries;

    expect(
      await h.service.revokeShares(["Projects"]),
    ).toEqual({ ok: true, revoked: 1 });

    expect(h.store.read(ideas.locator)).toBeNull();
    expect(h.store.read(welcome.locator)).not.toBeNull();
    expect([...(h.engine.getState().shares?.entries.keys() ?? [])]).toEqual([
      welcome.id,
    ]);
  });

  it("stops at the first failure and keeps what it already revoked", async () => {
    const store = createFakeShareStore();
    let deletes = 0;
    const fake: FakeForgeAdapter = await createSampleNotesRepoAdapter({
      shares: { store, provider: "github" },
      onContentCreatingRequest: ({ operation }) => {
        if (operation !== "deleteShare") return;
        deletes += 1;
        if (deletes === 1) fake.failNext("deleteShare", new ForgeError("Network"));
      },
    });
    const h = await setup(fake, store);
    const first = await h.service.createShare({ path: WELCOME, password: "" });
    const second = await h.service.createShare({ path: IDEAS, password: "" });
    if (!first.ok || !second.ok) throw new Error("failed");
    await settle(h.engine);

    const result = await h.service.revokeShares([]);

    expect(result).toEqual({ ok: false, error: { kind: "network" }, revoked: 1 });
    const left = [...(h.engine.getState().shares?.entries.values() ?? [])];
    expect(left).toHaveLength(1);
    expect(h.store.read(left[0].locator)).not.toBeNull();
    const gone = [first.entry, second.entry].find((e) => e.id !== left[0].id);
    expect(gone && h.store.read(gone.locator)).toBeNull();
  });

  it("treats a hosted copy that is already gone as revoked", async () => {
    const { h, entries } = await sharedTwice();
    h.store.delete(entries[0].locator);

    expect(
      await h.service.revokeShares(WELCOME),
    ).toEqual({ ok: true, revoked: 1 });
    expect(h.engine.getState().shares?.entries.has(entries[0].id)).toBe(false);
  });
});

describe("shareErrorOf", () => {
  it.each([
    [new ForgeError("Forbidden"), "create", { kind: "permissionMissing" }],
    [new ForgeError("NotFound"), "create", { kind: "permissionMissing" }],
    [new ForgeError("NotFound"), "update", { kind: "shareMissing" }],
    [new ForgeError("NotFound"), "delete", { kind: "server" }],
    [new ForgeError("Forbidden"), "update", { kind: "permissionMissing" }],
    [new ForgeError("Network"), "update", { kind: "network" }],
    [new ForgeError("Network"), "delete", { kind: "network" }],
    [new ForgeError("Unauthorized"), "delete", { kind: "unauthorized" }],
    [new ForgeError("Server"), "create", { kind: "server" }],
    [
      new ForgeError("RateLimited", { retryAfterMs: 5000 }),
      "create",
      { kind: "rateLimited", retryAfterMs: 5000 },
    ],
  ] as const)("maps %s on %s", (error, operation, expected) => {
    expect(shareErrorOf(error, operation)).toEqual(expected);
  });
});
