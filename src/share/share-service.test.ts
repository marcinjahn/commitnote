import { beforeAll, describe, expect, it } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { argon2idDirect } from "../crypto/argon2";
import { encryptNote } from "../crypto/note-cipher";
import { ForgeError } from "../forge/errors";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import {
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

describe("shareErrorOf", () => {
  it.each([
    [new ForgeError("Forbidden"), "create", { kind: "permissionMissing" }],
    [new ForgeError("NotFound"), "create", { kind: "permissionMissing" }],
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
