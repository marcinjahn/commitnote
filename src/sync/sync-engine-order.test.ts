import { beforeAll, describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import { argon2idDirect } from "../crypto/argon2";
import { deriveKeyring, type Keyring } from "../crypto/keyring";
import {
  parseRepoConfig,
  serializeRepoConfig,
  type RepoConfig,
} from "../crypto/repo-config";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { ORDER_PATH, REPO_CONFIG_PATH, TRAILER } from "../format/v1";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../testing/sample-notes-repo/sample-source";
import { createSyncEngine, type SyncEngine } from "./sync-engine";
import { createTestClock } from "./testing/test-clock";
import { findWorkingNode, type WorkingFolder } from "./working-tree";

let keyring: Keyring;
let sampleConfig: RepoConfig;

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
  sampleConfig = parsed.config;
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

  it("marks only the moved item as unsaved, though every sibling gets a position", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);

    engine.place(["Welcome"], { parent: [], before: "Empty folder" });

    const { syncStates } = engine.getState();
    expect(syncStates.stateOf(["Welcome"])).toEqual({ kind: "syncing" });
    expect(syncStates.stateOf(["Journal"])).toEqual({ kind: "synced" });
    expect(syncStates.unsavedCount).toBe(1);
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
  async function openWithSettings(
    settings: Record<string, unknown>,
  ): Promise<{ fake: FakeForgeAdapter; engine: SyncEngine }> {
    const fake = await createSampleNotesRepoAdapter();
    await fake.pushFromAnotherDevice([
      {
        kind: "upsert-text",
        path: REPO_CONFIG_PATH,
        text: serializeRepoConfig({ ...sampleConfig, settings }),
      },
    ]);
    return { fake, engine: await openEngine(fake) };
  }

  it("puts a new note first in a folder that was never reordered by default", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);

    expect(engine.createNote([], "Aardvark").ok).toBe(true);
    await engine.flush();

    expect(namesIn(engine, [])).toEqual(["Aardvark", ...ROOT_ORDER]);
    expect(await savedNamesIn(fake, [])).toEqual(["Aardvark", ...ROOT_ORDER]);
  });

  it("puts a new note first in a reordered folder by default", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);

    engine.createNote(COMMITNOTE, "Alpha");
    await engine.flush();

    expect(namesIn(engine, COMMITNOTE)).toEqual(["Alpha", "Roadmap", "Ideas"]);
    expect(await savedNamesIn(fake, COMMITNOTE)).toEqual([
      "Alpha",
      "Roadmap",
      "Ideas",
    ]);
  });

  it("puts a new note last when notes are placed at the end", async () => {
    const { fake, engine } = await openWithSettings({ newNotePlacement: "end" });

    engine.createNote([], "Aardvark");
    engine.createNote(COMMITNOTE, "Alpha");
    await engine.flush();

    expect(namesIn(engine, [])).toEqual([...ROOT_ORDER, "Aardvark"]);
    expect(await savedNamesIn(fake, [])).toEqual([...ROOT_ORDER, "Aardvark"]);
    expect(await savedNamesIn(fake, COMMITNOTE)).toEqual([
      "Roadmap",
      "Ideas",
      "Alpha",
    ]);
  });

  it("puts a new folder last by default", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);

    engine.createFolder([], "Aaa");
    await engine.flush();

    expect(namesIn(engine, [])).toEqual([...ROOT_ORDER, "Aaa"]);
    expect(await savedNamesIn(fake, [])).toEqual([...ROOT_ORDER, "Aaa"]);
  });

  it("puts a new folder first when folders are placed at the beginning", async () => {
    const { fake, engine } = await openWithSettings({
      newFolderPlacement: "beginning",
    });

    engine.createFolder([], "Aaa");
    engine.createFolder(COMMITNOTE, "Bbb");
    await engine.flush();

    expect(namesIn(engine, [])).toEqual(["Aaa", ...ROOT_ORDER]);
    expect(await savedNamesIn(fake, [])).toEqual(["Aaa", ...ROOT_ORDER]);
    expect(await savedNamesIn(fake, COMMITNOTE)).toEqual([
      "Bbb",
      "Roadmap",
      "Ideas",
    ]);
  });

  it("puts a new folder after the last folder in a folder that was never reordered", async () => {
    const { fake, engine } = await openWithSettings({
      newFolderPlacement: "afterLastFolder",
    });

    engine.createFolder([], "Aaa");
    await engine.flush();

    const expected = [
      "Empty folder",
      "Journal",
      "Projects",
      "Aaa",
      "Welcome",
      "Zażółć gęślą jaźń",
    ];
    expect(namesIn(engine, [])).toEqual(expected);
    expect(await savedNamesIn(fake, [])).toEqual(expected);
  });

  it("puts a new folder after the last folder in a reordered folder that mixes folders and notes", async () => {
    const { fake, engine } = await openWithSettings({
      newFolderPlacement: "afterLastFolder",
    });
    engine.createFolder(COMMITNOTE, "Sub");
    engine.place([...COMMITNOTE, "Sub"], {
      parent: COMMITNOTE,
      before: "Ideas",
    });
    expect(namesIn(engine, COMMITNOTE)).toEqual(["Roadmap", "Sub", "Ideas"]);

    engine.createFolder(COMMITNOTE, "Zed");
    await engine.flush();

    const expected = ["Roadmap", "Sub", "Zed", "Ideas"];
    expect(namesIn(engine, COMMITNOTE)).toEqual(expected);
    expect(await savedNamesIn(fake, COMMITNOTE)).toEqual(expected);
  });

  it("puts a new folder first in a parent without folders when placed after the last folder", async () => {
    const { fake, engine } = await openWithSettings({
      newFolderPlacement: "afterLastFolder",
    });

    engine.createFolder(COMMITNOTE, "Sub");
    await engine.flush();

    expect(await savedNamesIn(fake, COMMITNOTE)).toEqual([
      "Sub",
      "Roadmap",
      "Ideas",
    ]);
  });

  it("applies the placement within the parent that receives the item only", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);

    engine.createNote(["Projects"], "Alpha");
    await engine.flush();

    expect(await savedNamesIn(fake, ["Projects"])).toEqual([
      "Alpha",
      "commitnote",
    ]);
    expect(await savedNamesIn(fake, [])).toEqual(ROOT_ORDER);
    expect(await savedNamesIn(fake, COMMITNOTE)).toEqual(["Roadmap", "Ideas"]);
  });

  it("uses a settings change for the very next create", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const engine = await openEngine(fake);

    engine.createNote([], "Aaa");
    engine.changeSettings({ newNotePlacement: "end" });
    engine.createNote([], "Bbb");
    await engine.flush();

    expect(namesIn(engine, [])).toEqual(["Aaa", ...ROOT_ORDER, "Bbb"]);
    expect(await savedNamesIn(fake, [])).toEqual(["Aaa", ...ROOT_ORDER, "Bbb"]);
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

