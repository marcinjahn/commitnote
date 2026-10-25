import { beforeAll, describe, expect, it } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { argon2idDirect } from "../crypto/argon2";
import { encryptPath } from "../crypto/name-cipher";
import { encryptNote } from "../crypto/note-cipher";
import type { NotePath } from "../changes/change";
import { ForgeError } from "../forge/errors";
import { SHARE_FILE } from "../forge/share-files";
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
import type { ImagePayload } from "../crypto/image-cipher";
import { formatImageReference } from "../images/image-reference";
import { shareImageFileName } from "../forge/share-files";
import {
  openShare,
  openShareImage,
  ShareOpenError,
} from "./share-envelope";
import { parseShareLink } from "./share-link";
import {
  createShareService,
  shareErrorOf,
  type ShareImages,
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

const NO_IMAGES: ShareImages = {
  read: () => Promise.resolve(null),
  reencode: (payload) => Promise.resolve({ ok: true, payload }),
};

async function setup(
  fake?: FakeForgeAdapter,
  store?: FakeShareStore,
  options: { images?: ShareImages; maxImages?: number } = {},
) {
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
    shareHost:
      options.maxImages === undefined
        ? adapter.shareHost
        : { ...adapter.shareHost, maxImages: options.maxImages },
    images: options.images ?? NO_IMAGES,
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
  const envelope = h.store.read(parsed.locator)?.[SHARE_FILE];
  if (envelope === undefined) throw new Error("not hosted");
  return envelope;
}

function hashOf(link: string): string {
  return link.slice(LINK_BASE.length);
}

const RELOCATIONS: [
  string,
  (engine: SyncEngine) => { ok: boolean },
  NotePath,
][] = [
  ["renamed", (engine) => engine.rename(WELCOME, "Renamed"), ["Renamed"]],
  [
    "moved into another folder",
    (engine) => engine.move(WELCOME, ["Projects"]),
    ["Projects", "Welcome"],
  ],
];

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
    const opened = (
      await openShare(
      hostedEnvelope(h, hashOf(result.link)),
      parsed.linkSecret,
      undefined,
      argon2idDirect,
      )
    ).note;
    expect(opened.markdown).toBe(saved);
    expect(opened.name).toBe("Welcome");
    expect(result.password).toBeNull();
  });

  it("stores a normalized label without sealing it", async () => {
    const h = await setup();

    const result = await h.service.createShare({
      path: WELCOME,
      password: "",
      label: "  For Anna ",
    });

    if (!result.ok) throw new Error(`failed: ${result.error.kind}`);
    expect(result.entry.label).toBe("For Anna");
    expect(result.entry.name).toBe("Welcome");
    expect(h.engine.getState().shares?.entries.get(result.entry.id)).toEqual(
      result.entry,
    );
    const hash = hashOf(result.link);
    expect(hostedEnvelope(h, hash)).not.toContain("For Anna");
    const parsed = parseShareLink(hash);
    if (parsed.kind !== "valid") throw new Error("invalid link");
    const opened = (
      await openShare(
      hostedEnvelope(h, hash),
      parsed.linkSecret,
      undefined,
      argon2idDirect,
      )
    ).note;
    expect(opened.name).toBe("Welcome");
    expect(JSON.stringify(opened)).not.toContain("For Anna");
  });

  it.each([undefined, "", "   "])(
    "stores no label for %j",
    async (label) => {
      const h = await setup();
      const result = await h.service.createShare({
        path: WELCOME,
        password: "",
        label,
      });
      if (!result.ok) throw new Error("failed");
      expect(result.entry.label).toBeNull();
    },
  );

  it("rejects a too long label before creating anything", async () => {
    const h = await setup();
    let calls = 0;
    const create = h.fake.shareHost.create;
    h.fake.shareHost.create = async (content) => {
      calls++;
      return create(content);
    };

    const result = await h.service.createShare({
      path: WELCOME,
      password: "",
      label: "x".repeat(101),
    });

    expect(result).toEqual({ ok: false, error: { kind: "labelTooLong" } });
    expect(calls).toBe(0);
    expect(h.engine.getState().shares?.entries.size).toBe(0);
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
      storedPath: newest.kind === "found" ? newest.version.storedPath : null,
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

  it.each(RELOCATIONS)(
    "records the older content write of a note only %s since",
    async (_, relocate, path) => {
      const h = await setup();
      const content = await mainContent(h.fake, WELCOME);
      expect(relocate(h.engine).ok).toBe(true);
      await settle(h.engine);

      const result = await h.service.createShare({ path, password: "" });

      if (!result.ok) throw new Error(`failed: ${result.error.kind}`);
      const source = result.entry.source;
      if (!source) throw new Error("no source");
      const head = await h.fake.getHead();
      const history = createNoteHistory({ adapter: h.fake, keyring });
      const newest = await history.newestVersion(path, head);
      if (newest.kind !== "found") throw new Error("no version");
      expect(newest.version.sha).not.toBe(head);
      expect(source.commit).toBe(newest.version.sha);
      expect(source.storedPath).toBe(newest.version.storedPath);
      expect(source.storedPath).not.toBe(await encryptPath(keyring, path));
      const read = await history.readVersion({
        sha: source.commit,
        storedPath: source.storedPath,
        committedAt: 0,
        name: null,
        events: [],
      });
      expect(read).toMatchObject({ kind: "readable", content });
    },
  );

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
    const opened = (
      await openShare(
      envelope,
      result.entry.linkSecret,
      "hunter2",
      argon2idDirect,
      )
    ).note;
    expect(opened.name).toBe("Welcome");
  });

  it("refuses without calling the host when the rate budget is exhausted", async () => {
    const h = await setup();
    for (let i = 0; i < h.fake.limits.perMinute; i++) h.budget.record();
    let calls = 0;
    const create = h.fake.shareHost.create;
    h.fake.shareHost.create = async (content) => {
      calls++;
      return create(content);
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
    const hosted = await readers[parsed.locator.provider].read(
      parsed.locator,
    );
    return (
      await openShare(
        hosted.envelope,
        parsed.linkSecret,
        password,
        argon2idDirect,
      )
    ).note;
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
    h.fake.shareHost.update = async (locator, content) => {
      calls++;
      return update(locator, content);
    };

    const second = await h.service.updateShare(created.entry.id);

    expect(second).toEqual({ ok: true, entry: first.entry, unchanged: true });
    expect(calls).toBe(0);
  });

  it("records the updated version's own stored path and reads it back", async () => {
    const { h, created } = await shared();
    h.engine.editNote(WELCOME, "# Fresh\n\nnew text");

    const result = await h.service.updateShare(created.entry.id);

    if (!result.ok) throw new Error("failed");
    const source = result.entry.source;
    if (!source) throw new Error("no source");
    const history = createNoteHistory({ adapter: h.fake, keyring });
    const newest = await history.newestVersion(WELCOME, await h.fake.getHead());
    if (newest.kind !== "found") throw new Error("no version");
    expect(source.commit).toBe(newest.version.sha);
    expect(source.storedPath).toBe(newest.version.storedPath);
    const read = await history.readVersion({
      sha: source.commit,
      storedPath: source.storedPath,
      committedAt: 0,
      name: null,
      events: [],
    });
    expect(read).toMatchObject({
      kind: "readable",
      content: "# Fresh\n\nnew text",
    });
  });

  it("keeps the label", async () => {
    const h = await setup();
    const created = await h.service.createShare({
      path: WELCOME,
      password: "",
      label: "For Anna",
    });
    if (!created.ok) throw new Error("failed");
    await settle(h.engine);
    h.engine.editNote(WELCOME, "# Fresh\n\nnew text");

    const result = await h.service.updateShare(created.entry.id);

    if (!result.ok) throw new Error(`failed: ${result.error.kind}`);
    expect(result.unchanged).toBe(false);
    expect(result.entry.label).toBe("For Anna");
    expect(
      h.engine.getState().shares?.entries.get(created.entry.id)?.label,
    ).toBe("For Anna");
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

  it.each(RELOCATIONS)(
    "reports unchanged for a note only %s since",
    async (_, relocate) => {
      const { h, created } = await shared();
      expect(relocate(h.engine).ok).toBe(true);
      await settle(h.engine);
      const before = h.engine.getState().shares?.entries.get(created.entry.id);
      if (!before) throw new Error("no entry");

      const result = await h.service.updateShare(created.entry.id);

      expect(result).toEqual({ ok: true, entry: before, unchanged: true });
      expect(before.source).toEqual(created.entry.source);
      expect(h.engine.getState().shares?.entries.get(created.entry.id)).toBe(
        before,
      );
    },
  );

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
      images: NO_IMAGES,
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

describe("share images", () => {
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
  const imageIdOf = (n: number) => "a".repeat(25) + ALPHABET[n];
  const numberOf = (id: string) => ALPHABET.indexOf(id.slice(-1));

  function payloadOf(n: number, size = 10): ImagePayload {
    return {
      type: "image/webp",
      width: 1,
      height: 1,
      bytes: new Uint8Array(size).fill(n % 256),
    };
  }

  function noteWith(ids: readonly string[]): string {
    return ids
      .map((id) => formatImageReference({ imageId: id, alt: "pic", width: 10, height: 10 }))
      .join("\n\n");
  }

  function fakeImages(overrides: Partial<ShareImages> = {}) {
    const reads: string[] = [];
    const images: ShareImages = {
      read: (id) => {
        reads.push(id);
        return Promise.resolve(payloadOf(numberOf(id)));
      },
      reencode: (payload) => Promise.resolve({ ok: true, payload }),
      ...overrides,
    };
    return { images, reads };
  }

  async function hostedImages(
    h: Harness,
    link: string,
  ): Promise<{ imageId: string; bytes: Uint8Array }[]> {
    const parsed = parseShareLink(hashOf(link));
    if (parsed.kind !== "valid") throw new Error("invalid link");
    const opened = await openShare(
      hostedEnvelope(h, hashOf(link)),
      parsed.linkSecret,
      undefined,
      argon2idDirect,
    );
    const files = h.store.read(parsed.locator) ?? {};
    return Promise.all(
      opened.note.images.map(async (image, index) => {
        const content = files[shareImageFileName(index)];
        if (content === undefined) throw new Error("missing image file");
        const payload = await openShareImage(opened.shareKey, index, content);
        return { imageId: image.imageId, bytes: payload.bytes };
      }),
    );
  }

  function hostedFileCount(h: Harness, link: string): number {
    const parsed = parseShareLink(hashOf(link));
    if (parsed.kind !== "valid") throw new Error("invalid link");
    return Object.keys(h.store.read(parsed.locator) ?? {}).length;
  }

  async function createWith(
    ids: readonly string[],
    options: { images?: ShareImages; maxImages?: number } = {},
  ) {
    const { images, reads } = fakeImages();
    const h = await setup(undefined, undefined, {
      images,
      ...options,
    });
    h.engine.editNote(WELCOME, noteWith(ids));
    const result = await h.service.createShare({ path: WELCOME, password: "" });
    return { h, result, reads };
  }

  it("hosts each referenced image once, in reference order", async () => {
    const [a, b] = [imageIdOf(1), imageIdOf(2)];
    const { h, result, reads } = await createWith([b, a, b]);

    if (!result.ok) throw new Error(`failed: ${result.error.kind}`);
    expect(reads).toEqual([b, a]);
    const hosted = await hostedImages(h, result.link);
    expect(hosted.map((image) => image.imageId)).toEqual([b, a]);
    expect(hosted[0]?.bytes).toEqual(payloadOf(2).bytes);
    expect(hosted[1]?.bytes).toEqual(payloadOf(1).bytes);
  });

  it("hosts no image files for a note without images", async () => {
    const { h, result } = await createWith([]);

    if (!result.ok) throw new Error(`failed: ${result.error.kind}`);
    expect(hostedFileCount(h, result.link)).toBe(1);
  });

  it("refuses more than 20 images before reading any", async () => {
    const ids = Array.from({ length: 21 }, (_, i) => imageIdOf(i + 1));
    const { result, reads } = await createWith(ids);

    expect(result).toEqual({ ok: false, error: { kind: "tooManyImages" } });
    expect(reads).toEqual([]);
  });

  it("accepts exactly 20 images", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => imageIdOf(i + 1));
    const { h, result } = await createWith(ids);

    if (!result.ok) throw new Error(`failed: ${result.error.kind}`);
    expect(await hostedImages(h, result.link)).toHaveLength(20);
  });

  it("limits images to what the host accepts", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => imageIdOf(i + 1));
    const tooMany = await createWith(ids, { maxImages: 9 });
    expect(tooMany.result).toEqual({
      ok: false,
      error: { kind: "tooManyImages" },
    });
    expect(tooMany.reads).toEqual([]);

    const fits = await createWith(ids.slice(0, 9), { maxImages: 9 });
    if (!fits.result.ok) throw new Error("failed");
    expect(await hostedImages(fits.h, fits.result.link)).toHaveLength(9);
  });

  it("skips an image that no longer exists", async () => {
    const [a, b] = [imageIdOf(1), imageIdOf(2)];
    const { images } = fakeImages({
      read: (id) => Promise.resolve(id === a ? null : payloadOf(2)),
    });
    const { h, result } = await createWith([a, b], { images });

    if (!result.ok) throw new Error(`failed: ${result.error.kind}`);
    expect((await hostedImages(h, result.link)).map((i) => i.imageId)).toEqual([
      b,
    ]);
  });

  it("skips an image the pipeline cannot process", async () => {
    const [a, b] = [imageIdOf(1), imageIdOf(2)];
    const { images } = fakeImages({
      reencode: (payload) =>
        Promise.resolve(
          payload.bytes[0] === 1
            ? { ok: false, rejection: { kind: "unsupported" } }
            : { ok: true, payload },
        ),
    });
    const { h, result } = await createWith([a, b], { images });

    if (!result.ok) throw new Error(`failed: ${result.error.kind}`);
    expect((await hostedImages(h, result.link)).map((i) => i.imageId)).toEqual([
      b,
    ]);
  });

  it("refuses an image that stays too large after compression", async () => {
    const { images } = fakeImages({
      reencode: () =>
        Promise.resolve({
          ok: false,
          rejection: { kind: "tooLargeAfterCompression" },
        }),
    });
    const { result } = await createWith([imageIdOf(1)], { images });

    expect(result).toEqual({ ok: false, error: { kind: "tooManyImages" } });
  });

  it("refuses an image that does not fit in a share file", async () => {
    const { images } = fakeImages({
      reencode: () =>
        Promise.resolve({
          ok: true,
          payload: {
            type: "image/gif",
            width: 1,
            height: 1,
            bytes: new Uint8Array(700_000),
          },
        }),
    });
    const { result } = await createWith([imageIdOf(1)], { images });

    expect(result).toEqual({ ok: false, error: { kind: "tooManyImages" } });
  });

  it("keeps the forge error kind when reading an image fails", async () => {
    const { images } = fakeImages({
      read: () => Promise.reject(new ForgeError("Network")),
    });
    const { result } = await createWith([imageIdOf(1)], { images });

    expect(result).toEqual({ ok: false, error: { kind: "network" } });
  });

  it("fails with server when re-encoding throws", async () => {
    const { images } = fakeImages({
      reencode: () => Promise.reject(new Error("boom")),
    });
    const { result } = await createWith([imageIdOf(1)], { images });

    expect(result).toEqual({ ok: false, error: { kind: "server" } });
  });

  describe("on update", () => {
    it("rewrites the image files and removes unused ones", async () => {
      const [a, b] = [imageIdOf(1), imageIdOf(2)];
      const { h, result } = await createWith([a, b]);
      if (!result.ok) throw new Error("failed");
      await settle(h.engine);
      h.engine.editNote(WELCOME, noteWith([b]));

      const updated = await h.service.updateShare(result.entry.id);

      if (!updated.ok) throw new Error(`failed: ${updated.error.kind}`);
      const hosted = await hostedImages(h, result.link);
      expect(hosted.map((image) => image.imageId)).toEqual([b]);
      expect(hostedFileCount(h, result.link)).toBe(2);
    });

    it("makes no image reads when nothing changed", async () => {
      const { h, result, reads } = await createWith([imageIdOf(1)]);
      if (!result.ok) throw new Error("failed");
      await settle(h.engine);
      reads.length = 0;

      const updated = await h.service.updateShare(result.entry.id);

      expect(updated).toMatchObject({ ok: true, unchanged: true });
      expect(reads).toEqual([]);
    });

    it("refuses a note that gained too many images", async () => {
      const { h, result } = await createWith([imageIdOf(1)]);
      if (!result.ok) throw new Error("failed");
      await settle(h.engine);
      h.engine.editNote(
        WELCOME,
        noteWith(Array.from({ length: 21 }, (_, i) => imageIdOf(i + 1))),
      );

      expect(await h.service.updateShare(result.entry.id)).toEqual({
        ok: false,
        error: { kind: "tooManyImages" },
      });
    });
  });
});

describe("setShareLabel", () => {
  async function shared() {
    const h = await setup();
    const result = await h.service.createShare({ path: WELCOME, password: "" });
    if (!result.ok) throw new Error("failed");
    await settle(h.engine);
    return { h, entry: result.entry };
  }

  function labelOf(h: Harness, id: string) {
    return h.engine.getState().shares?.entries.get(id)?.label;
  }

  it("sets a normalized label and clears it with an empty one", async () => {
    const { h, entry } = await shared();

    expect(h.service.setShareLabel(entry.id, "  For Anna ")).toEqual({
      ok: true,
    });
    expect(labelOf(h, entry.id)).toBe("For Anna");
    await settle(h.engine);

    expect(h.service.setShareLabel(entry.id, "")).toEqual({ ok: true });
    expect(labelOf(h, entry.id)).toBeNull();
  });

  it("never calls the share host or spends the rate budget", async () => {
    const { h, entry } = await shared();
    const calls: string[] = [];
    for (const method of ["create", "update", "delete"] as const) {
      const original = h.fake.shareHost[method] as (
        ...args: never[]
      ) => Promise<unknown>;
      (h.fake.shareHost as unknown as Record<string, unknown>)[method] = (
        ...args: never[]
      ) => {
        calls.push(method);
        return original(...args);
      };
    }
    const availableAt = h.budget.availableAt(1);

    h.service.setShareLabel(entry.id, "For Anna");
    await settle(h.engine);

    expect(calls).toEqual([]);
    expect(h.budget.availableAt(1)).toBe(availableAt);
  });

  it("reports shareGone for an unknown share", async () => {
    const { h } = await shared();
    expect(h.service.setShareLabel("missing", "x")).toEqual({
      ok: false,
      error: { kind: "shareGone" },
    });
  });

  it("reports labelTooLong and keeps the label", async () => {
    const { h, entry } = await shared();
    expect(h.service.setShareLabel(entry.id, "x".repeat(101))).toEqual({
      ok: false,
      error: { kind: "labelTooLong" },
    });
    expect(labelOf(h, entry.id)).toBeNull();
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

    expect(h.service.setShareLabel("any", "x")).toEqual({
      ok: false,
      error: { kind: "sharesUnavailable" },
    });
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
