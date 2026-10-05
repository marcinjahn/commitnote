import { beforeAll, describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { FORMAT_VERSION, SAVE_SUBJECT, TAGS_PATH, TRAILER } from "../format/v1";
import { createNoteHistory } from "../history/note-history";
import type { ColorTag } from "../tags/color-tag";
import { colorTagOf, readTagIndex, type TagIndex } from "../tags/tag-index";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { createSyncEngine, type SyncEngine } from "./sync-engine";
import {
  IDEAS,
  WELCOME,
  ZAZOLC,
  mainContent,
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

async function autosave(h: Harness): Promise<void> {
  h.clock.advance(2_000);
  await waitIdle(h.engine);
}

function workingColor(engine: SyncEngine, path: NotePath): ColorTag | null {
  const node = findWorkingNode(engine.getState().workingTree!, path);
  if (node?.kind !== "note") throw new Error("expected a note");
  return node.colorTag;
}

async function remoteTags(fake: FakeForgeAdapter): Promise<TagIndex> {
  const listing = await fake.listTree(await fake.getHead());
  return readTagIndex(listing, keyring, (sha) => fake.readBlob(sha));
}

async function remoteColor(
  fake: FakeForgeAdapter,
  path: NotePath,
): Promise<ColorTag | null> {
  return colorTagOf(await remoteTags(fake), path);
}

async function tagsBlobSha(fake: FakeForgeAdapter): Promise<string | null> {
  const listing = await fake.listTree(await fake.getHead());
  return listing.find((entry) => entry.path === TAGS_PATH)?.sha ?? null;
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

describe("SyncEngine.setColorTag", () => {
  it("collapses rapid changes into one commit after the debounce carrying the last color", async () => {
    const h = await setup();
    const start = await h.fake.getHead();

    expect(h.engine.setColorTag(WELCOME, "red")).toEqual({
      ok: true,
      path: WELCOME,
    });
    h.engine.setColorTag(WELCOME, "green");
    h.engine.setColorTag(WELCOME, "blue");
    h.clock.advance(1_999);
    await waitIdle(h.engine);
    expect(okCommitCount(h.fake, start)).toBe(0);

    h.clock.advance(1);
    await waitIdle(h.engine);

    expect(okCommitCount(h.fake, start)).toBe(1);
    expect(await remoteColor(h.fake, WELCOME)).toBe("blue");
  });

  it.each([
    ["the same note", WELCOME],
    ["another note", IDEAS],
  ])(
    "commits a color tag and an edit of %s within the debounce together",
    async (_, edited) => {
      const h = await setup();
      const start = await h.fake.getHead();

      h.engine.setColorTag(WELCOME, "yellow");
      h.engine.editNote(edited, "edited");
      await autosave(h);

      expect(okCommitCount(h.fake, start)).toBe(1);
      expect(await remoteColor(h.fake, WELCOME)).toBe("yellow");
      expect(await mainContent(h.fake, edited)).toBe("edited");
    },
  );

  it("drops the change when the color is set back to the saved one", async () => {
    const h = await setup();
    const start = await h.fake.getHead();

    h.engine.setColorTag(WELCOME, "red");
    h.engine.setColorTag(WELCOME, null);

    expect(h.engine.getState().pending).toEqual([]);
    await autosave(h);
    expect(okCommitCount(h.fake, start)).toBe(0);
  });

  it("returns ok without queueing anything when the color is unchanged", async () => {
    const h = await setup();

    expect(h.engine.setColorTag(WELCOME, null)).toEqual({
      ok: true,
      path: WELCOME,
    });
    expect(h.engine.getState().pending).toEqual([]);
  });

  it("shows the color at once and marks the note pending until saved", async () => {
    const h = await setup();

    h.engine.setColorTag(WELCOME, "purple");

    expect(workingColor(h.engine, WELCOME)).toBe("purple");
    expect(h.engine.getState().syncStates.stateOf(WELCOME)).toEqual({
      kind: "out-of-sync",
      reason: "pending",
    });

    await autosave(h);
    expect(h.engine.getState().syncStates.stateOf(WELCOME)).toEqual({
      kind: "synced",
    });
    expect(workingColor(h.engine, WELCOME)).toBe("purple");
  });

  it("keeps the color through rename, move, delete to trash and undo", async () => {
    const h = await setup();
    h.engine.setColorTag(IDEAS, "orange");
    await h.engine.flush();

    const renamed = h.engine.rename(IDEAS, "Plans");
    if (!renamed.ok) throw new Error("rename failed");
    await h.engine.flush();
    expect(workingColor(h.engine, renamed.path)).toBe("orange");
    expect(await remoteColor(h.fake, renamed.path)).toBe("orange");

    const moved = h.engine.move(renamed.path, []);
    if (!moved.ok) throw new Error("move failed");
    await h.engine.flush();
    expect(workingColor(h.engine, moved.path)).toBe("orange");
    expect(await remoteColor(h.fake, moved.path)).toBe("orange");

    const trashed = h.engine.delete(moved.path);
    if (!trashed.ok) throw new Error("delete failed");
    await h.engine.flush();
    expect(await remoteColor(h.fake, moved.path)).toBeNull();

    expect(h.engine.undoTrash(trashed.trashEntryId!).ok).toBe(true);
    await h.engine.flush();
    expect(workingColor(h.engine, moved.path)).toBe("orange");
    expect(await remoteColor(h.fake, moved.path)).toBe("orange");
  });

  it("refuses when the stored tags can't be read and still saves other changes", async () => {
    const fake = await createSampleNotesRepoAdapter();
    await fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: TAGS_PATH, text: "unreadable" },
    ]);
    const h = await openEngine(fake);
    const tagsBefore = await tagsBlobSha(fake);
    const start = await fake.getHead();

    expect(h.engine.setColorTag(WELCOME, "red")).toEqual({
      ok: false,
      error: { kind: "tagsUnavailable" },
    });
    expect(workingColor(h.engine, WELCOME)).toBeNull();

    expect(h.engine.rename(WELCOME, "Hello").ok).toBe(true);
    await h.engine.flush();

    expect(okCommitCount(fake, start)).toBe(1);
    expect(await tagsBlobSha(fake)).toBe(tagsBefore);
  });

  it("refuses a folder or a missing path as not found", async () => {
    const h = await setup();

    expect(h.engine.setColorTag(["Projects"], "red")).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
    expect(h.engine.setColorTag(["Missing"], "red")).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
    expect(h.engine.getState().pending).toEqual([]);
  });

  it("commits a tag-only change with the plain save message", async () => {
    const h = await setup();
    const start = await h.fake.getHead();

    h.engine.setColorTag(ZAZOLC, "green");
    await autosave(h);

    expect(messagesSince(h.fake, start)).toEqual([
      `${SAVE_SUBJECT}\n\n${TRAILER.format}: ${FORMAT_VERSION}`,
    ]);
  });

  it("leaves a tag-only commit out of the note's version history", async () => {
    const h = await setup();
    h.engine.editNote(WELCOME, "edited");
    await h.engine.flush();
    const editHead = await h.fake.getHead();

    h.engine.setColorTag(WELCOME, "blue");
    await h.engine.flush();
    const tagHead = await h.fake.getHead();
    expect(tagHead).not.toBe(editHead);

    const history = createNoteHistory({ adapter: h.fake, keyring });
    const cursor = history.open(WELCOME, tagHead);
    for (let i = 0; i < 20 && cursor.getState().end === null; i++) {
      await cursor.loadMore();
      if (cursor.getState().error !== null) break;
    }
    const shas = cursor.getState().versions.map((version) => version.sha);

    expect(shas).not.toContain(tagHead);
    expect(shas[0]).toBe(editHead);
  });
});

describe("SyncEngine.setColorTag across devices", () => {
  it("shows a tag saved on another device after refresh", async () => {
    const first = await setup();
    const second = await openEngine(first.fake);

    first.engine.setColorTag(WELCOME, "red");
    await first.engine.flush();
    await second.engine.refresh();

    expect(workingColor(second.engine, WELCOME)).toBe("red");
  });

  it("keeps tags both devices gave to different notes", async () => {
    const first = await setup();
    const second = await openEngine(first.fake);

    first.engine.setColorTag(WELCOME, "red");
    await first.engine.flush();
    second.engine.setColorTag(IDEAS, "blue");
    await second.engine.flush();

    expect(await remoteColor(first.fake, WELCOME)).toBe("red");
    expect(await remoteColor(first.fake, IDEAS)).toBe("blue");
    expect(workingColor(second.engine, WELCOME)).toBe("red");
    expect(second.engine.getState().notices).toEqual([]);
  });

  it("keeps the later save when both devices tag the same note", async () => {
    const first = await setup();
    const second = await openEngine(first.fake);

    first.engine.setColorTag(WELCOME, "red");
    await first.engine.flush();
    second.engine.setColorTag(WELCOME, "blue");
    await second.engine.flush();

    expect(await remoteColor(first.fake, WELCOME)).toBe("blue");
    expect(second.engine.getState().notices).toEqual([]);
    expect(second.engine.getState().conflicts).toEqual([]);
  });

  it("commits a pending tag over a remote edit of another note", async () => {
    const h = await setup();
    h.engine.setColorTag(WELCOME, "green");
    const remoteHead = await pushRemote(h.fake, [
      { kind: "update-note", path: IDEAS, content: "remote ideas" },
    ]);

    await autosave(h);

    const head = await h.fake.getHead();
    expect(h.fake.repo.getCommit(head)?.parent).toBe(remoteHead);
    expect(await remoteColor(h.fake, WELCOME)).toBe("green");
    expect(await mainContent(h.fake, IDEAS)).toBe("remote ideas");
    expect(h.engine.getState().notices).toEqual([]);
  });

  it("commits a pending tag at the new path when the remote renamed the note", async () => {
    const h = await setup();
    h.engine.setColorTag(WELCOME, "green");
    await pushRemote(h.fake, [
      { kind: "rename-note", from: WELCOME, to: ["Hello"] },
    ]);

    await autosave(h);

    expect(await remoteColor(h.fake, ["Hello"])).toBe("green");
    expect(await remoteColor(h.fake, WELCOME)).toBeNull();
    expect(workingColor(h.engine, ["Hello"])).toBe("green");
    expect(h.engine.getState().pending).toEqual([]);
    expect(h.engine.getState().notices).toEqual([]);
  });

  it("drops a pending tag on a note the remote deleted without a notice", async () => {
    const h = await setup();
    h.engine.setColorTag(WELCOME, "green");
    const remoteHead = await pushRemote(h.fake, [
      { kind: "delete-note", path: WELCOME },
    ]);

    await autosave(h);

    expect(await h.fake.getHead()).toBe(remoteHead);
    expect((await remoteTags(h.fake)).notes.size).toBe(0);
    expect(h.engine.getState().pending).toEqual([]);
    expect(h.engine.getState().inFlight).toEqual([]);
    expect(h.engine.getState().notices).toEqual([]);
  });
});
