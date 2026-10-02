import { beforeAll, describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import { argon2idDirect } from "../crypto/argon2";
import { deriveKeyring, type Keyring } from "../crypto/keyring";
import { parseRepoConfig } from "../crypto/repo-config";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { ORDER_PATH, TRAILER } from "../format/v1";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../testing/sample-notes-repo/sample-source";
import { createSyncEngine, type SyncEngine } from "./sync-engine";
import { createTestClock } from "./testing/test-clock";
import { findWorkingNode, type WorkingFolder } from "./working-tree";

let keyring: Keyring;

beforeAll(async () => {
  const probe = await createSampleNotesRepoAdapter();
  const inspection = await probe.inspect();
  if (inspection.kind !== "populated" || inspection.main === null) {
    throw new Error("expected a populated sample notes repo");
  }
  const parsed = parseRepoConfig(inspection.main.repoConfigText ?? "");
  if (parsed.kind !== "valid") {
    throw new Error(`expected a valid repo config, got ${parsed.kind}`);
  }
  keyring = await deriveKeyring(
    SAMPLE_NOTES_REPO_PASSPHRASE,
    parsed.config.kdf,
    argon2idDirect,
  );
});

const COMMITNOTE = ["Projects", "commitnote"];
const ROOT_ORDER = [
  "Empty folder",
  "Journal",
  "Projects",
  "Welcome",
  "Zażółć gęślą jaźń",
];

async function openEngine(fake: FakeForgeAdapter): Promise<SyncEngine> {
  const engine = createSyncEngine({
    adapter: fake,
    keyring,
    clock: createTestClock(1_000_000),
  });
  await engine.refresh();
  return engine;
}

function namesIn(engine: SyncEngine, path: NotePath): string[] {
  const folder = findWorkingNode(engine.getState().workingTree!, path);
  if (folder?.kind !== "folder") throw new Error("expected a folder");
  return (folder as WorkingFolder).children.map((child) => child.name);
}

async function savedNamesIn(
  fake: FakeForgeAdapter,
  path: NotePath,
): Promise<string[]> {
  return namesIn(await openEngine(fake), path);
}

function messagesSince(fake: FakeForgeAdapter, since: string): string[] {
  const messages: string[] = [];
  let current: string | null | undefined = fake.repo.getRef("main");
  while (current !== since && current != null) {
    const commit: { message: string; parent: string | null } =
      fake.repo.getCommit(current)!;
    messages.unshift(commit.message);
    current = commit.parent;
  }
  return messages;
}

function trailerCount(message: string, trailer: string): number {
  return message.split("\n").filter((line) => line.startsWith(`${trailer}: `))
    .length;
}

describe("SyncEngine.place", () => {
  it("moves an item before a sibling and saves every sibling's position in one commit", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);
    const head = await fake.getHead();

    const result = engine.place(["Welcome"], {
      parent: [],
      before: "Empty folder",
    });
    await engine.flush();

    expect(result).toEqual({ ok: true, path: ["Welcome"] });
    const expected = [
      "Welcome",
      "Empty folder",
      "Journal",
      "Projects",
      "Zażółć gęślą jaźń",
    ];
    expect(namesIn(engine, [])).toEqual(expected);
    expect(await savedNamesIn(fake, [])).toEqual(expected);
    const messages = messagesSince(fake, head);
    expect(messages).toHaveLength(1);
    expect(trailerCount(messages[0], TRAILER.order)).toBe(5);
    expect(messages[0]).not.toContain("Welcome");
  });

  it("moves an item into another folder at the given position in one commit", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);
    const head = await fake.getHead();

    const result = engine.place(["Welcome"], {
      parent: COMMITNOTE,
      before: "Ideas",
    });
    await engine.flush();

    expect(result).toEqual({ ok: true, path: [...COMMITNOTE, "Welcome"] });
    expect(await savedNamesIn(fake, COMMITNOTE)).toEqual([
      "Roadmap",
      "Welcome",
      "Ideas",
    ]);
    const messages = messagesSince(fake, head);
    expect(messages).toHaveLength(1);
    expect(trailerCount(messages[0], TRAILER.rename)).toBe(1);
    expect(trailerCount(messages[0], TRAILER.order)).toBe(1);
  });

  it("puts an item last when no sibling follows it", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);

    engine.place([...COMMITNOTE, "Roadmap"], {
      parent: COMMITNOTE,
      before: null,
    });
    await engine.flush();

    expect(await savedNamesIn(fake, COMMITNOTE)).toEqual(["Ideas", "Roadmap"]);
  });

  it("records nothing when the item is already in that position", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);

    const result = engine.place([...COMMITNOTE, "Roadmap"], {
      parent: COMMITNOTE,
      before: "Ideas",
    });

    expect(result).toEqual({ ok: true, path: [...COMMITNOTE, "Roadmap"] });
    expect(engine.getState().pending).toEqual([]);
  });

  it("keeps the position of an item renamed in place once saved", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);

    engine.rename([...COMMITNOTE, "Roadmap"], "Plan");
    await engine.flush();

    expect(await savedNamesIn(fake, COMMITNOTE)).toEqual(["Plan", "Ideas"]);
  });

  it("refuses to move a folder into itself", async () => {
    const engine = await openEngine(await createSampleNotesRepoAdapter());

    expect(
      engine.place(["Projects"], { parent: COMMITNOTE, before: null }),
    ).toEqual({ ok: false, error: { kind: "invalidTarget" } });
  });

  it("refuses a folder that already has an item with the same name", async () => {
    const engine = await openEngine(await createSampleNotesRepoAdapter());
    engine.createNote(["Projects"], "Welcome");

    expect(
      engine.place(["Welcome"], { parent: ["Projects"], before: null }),
    ).toMatchObject({ ok: false, error: { kind: "invalidName" } });
  });

  it("refuses a sibling or item that doesn't exist", async () => {
    const engine = await openEngine(await createSampleNotesRepoAdapter());

    expect(
      engine.place(["Welcome"], { parent: [], before: "Missing" }),
    ).toEqual({ ok: false, error: { kind: "notFound" } });
    expect(engine.place(["Missing"], { parent: [], before: null })).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
  });

  it("refuses to reorder when the stored order can't be read", async () => {
    const fake = await createSampleNotesRepoAdapter();
    await fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: ORDER_PATH, text: "unreadable" },
    ]);
    const engine = await openEngine(fake);

    expect(
      engine.place(["Welcome"], { parent: [], before: "Journal" }),
    ).toEqual({ ok: false, error: { kind: "orderUnavailable" } });
  });
});

describe("SyncEngine.place across devices", () => {
  it("keeps the positions both devices gave to different items", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const first = await openEngine(fake);
    const second = await openEngine(fake);

    first.place([...COMMITNOTE, "Roadmap"], {
      parent: COMMITNOTE,
      before: null,
    });
    await first.flush();
    second.place(["Welcome"], { parent: [], before: "Empty folder" });
    await second.flush();

    expect(await savedNamesIn(fake, COMMITNOTE)).toEqual(["Ideas", "Roadmap"]);
    expect((await savedNamesIn(fake, []))[0]).toBe("Welcome");
    expect(second.getState().notices).toEqual([]);
  });

  it("keeps the position from the later save when both devices move the same item", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const first = await openEngine(fake);
    const second = await openEngine(fake);

    first.place(["Welcome"], { parent: [], before: "Empty folder" });
    await first.flush();
    second.place(["Welcome"], { parent: [], before: null });
    await second.flush();

    expect(await savedNamesIn(fake, [])).toEqual([
      "Empty folder",
      "Journal",
      "Projects",
      "Zażółć gęślą jaźń",
      "Welcome",
    ]);
  });

  it("drops the position of an item deleted on another device without a notice", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const first = await openEngine(fake);
    const second = await openEngine(fake);

    first.delete(["Welcome"]);
    await first.flush();
    second.place(["Welcome"], { parent: [], before: "Empty folder" });
    await second.flush();

    expect(second.getState().notices).toEqual([]);
    expect(second.getState().pending).toEqual([]);
    expect(await savedNamesIn(fake, [])).toEqual(
      ROOT_ORDER.filter((name) => name !== "Welcome"),
    );
  });
});

describe("SyncEngine create positions", () => {
  it("puts a new note last in a folder that was never reordered", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);

    expect(engine.createNote([], "Aardvark").ok).toBe(true);
    await engine.flush();

    expect(namesIn(engine, [])).toEqual([...ROOT_ORDER, "Aardvark"]);
    expect(await savedNamesIn(fake, [])).toEqual([...ROOT_ORDER, "Aardvark"]);
  });

  it("puts a new note last in a reordered folder", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);

    engine.createNote(COMMITNOTE, "Alpha");
    await engine.flush();

    expect(await savedNamesIn(fake, COMMITNOTE)).toEqual([
      "Roadmap",
      "Ideas",
      "Alpha",
    ]);
  });

  it("puts a new folder last", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);

    engine.createFolder([], "Aaa");
    engine.createNote([], "Bbb");
    await engine.flush();

    expect(await savedNamesIn(fake, [])).toEqual([...ROOT_ORDER, "Aaa", "Bbb"]);
  });

  it("creates an item without a position when the stored order can't be read", async () => {
    const fake = await createSampleNotesRepoAdapter();
    await fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: ORDER_PATH, text: "unreadable" },
    ]);
    const engine = await openEngine(fake);

    expect(engine.createNote([], "Aardvark").ok).toBe(true);

    const { inFlight, pending } = engine.getState();
    expect([...inFlight, ...pending]).toEqual([
      { kind: "create-note", path: ["Aardvark"], content: "" },
    ]);
  });
});

