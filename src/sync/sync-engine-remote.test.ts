import { beforeAll, describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { createSyncEngine, type SyncEngine } from "./sync-engine";
import { IDEAS, WELCOME, pushRemote, settle } from "./testing/engine-harness";
import { createTestClock } from "./testing/test-clock";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly engine: SyncEngine;
}

async function openAt(path: NotePath): Promise<Harness> {
  const fake = await createSampleNotesRepoAdapter();
  const clock = createTestClock(1_000_000);
  const engine = createSyncEngine({ adapter: fake, keyring, clock });
  await engine.refresh();
  await engine.openNote(path);
  return { fake, engine };
}

function loadedContent(engine: SyncEngine): string {
  const open = engine.getState().openNote;
  if (open?.kind !== "loaded") throw new Error("expected a loaded open note");
  return open.content;
}

function remoteNotices(engine: SyncEngine) {
  return engine
    .getState()
    .notices.filter(
      (notice) =>
        notice.kind === "remote-relocated" || notice.kind === "remote-updated",
    );
}

describe("following a remote relocation of the open note", () => {
  it("follows a remote note rename and keeps the content", async () => {
    const h = await openAt(WELCOME);
    const content = loadedContent(h.engine);

    await pushRemote(h.fake, [
      { kind: "rename-note", from: WELCOME, to: ["Hello"] },
    ]);
    await h.engine.refresh();

    expect(h.engine.getState().openNote).toEqual(
      expect.objectContaining({ kind: "loaded", path: ["Hello"], content }),
    );
    expect(remoteNotices(h.engine)).toMatchObject([
      { kind: "remote-relocated", from: WELCOME, to: ["Hello"] },
    ]);
  });

  it("follows a remote move into another folder", async () => {
    const h = await openAt(WELCOME);
    const content = loadedContent(h.engine);

    await pushRemote(h.fake, [
      { kind: "rename-note", from: WELCOME, to: ["Journal", "Welcome"] },
    ]);
    await h.engine.refresh();

    expect(h.engine.getState().openNote).toEqual(
      expect.objectContaining({
        kind: "loaded",
        path: ["Journal", "Welcome"],
        content,
      }),
    );
    expect(remoteNotices(h.engine)).toMatchObject([
      { kind: "remote-relocated", from: WELCOME, to: ["Journal", "Welcome"] },
    ]);
  });

  it("follows a remote rename of a folder holding the open note", async () => {
    const h = await openAt(IDEAS);
    const content = loadedContent(h.engine);
    const moved = ["Work", "commitnote", "Ideas"];

    await pushRemote(h.fake, [
      { kind: "rename-folder", from: ["Projects"], to: ["Work"] },
    ]);
    await h.engine.refresh();

    expect(h.engine.getState().openNote).toEqual(
      expect.objectContaining({ kind: "loaded", path: moved, content }),
    );
    expect(remoteNotices(h.engine)).toMatchObject([
      { kind: "remote-relocated", from: IDEAS, to: moved },
    ]);
  });

  it("follows a note renamed and edited in one remote commit, with the new content", async () => {
    const h = await openAt(WELCOME);

    await pushRemote(h.fake, [
      { kind: "rename-note", from: WELCOME, to: ["Hello"] },
      { kind: "update-note", path: ["Hello"], content: "# Hello\n\nedited\n" },
    ]);
    await h.engine.refresh();

    expect(h.engine.getState().openNote).toEqual(
      expect.objectContaining({
        kind: "loaded",
        path: ["Hello"],
        content: "# Hello\n\nedited\n",
      }),
    );
    expect(remoteNotices(h.engine)).toMatchObject([
      { kind: "remote-relocated", from: WELCOME, to: ["Hello"] },
    ]);
  });

  it("leaves the note missing without a notice when it cannot be located", async () => {
    const h = await openAt(WELCOME);

    await pushRemote(h.fake, [{ kind: "delete-note", path: WELCOME }]);
    await h.engine.refresh();

    expect(h.engine.getState().openNote).toEqual({
      kind: "missing",
      path: WELCOME,
    });
    expect(remoteNotices(h.engine)).toEqual([]);
  });

  it("follows nothing while there is local work", async () => {
    const h = await openAt(WELCOME);

    h.engine.editNote(IDEAS, "local ideas");
    await pushRemote(h.fake, [
      { kind: "rename-note", from: WELCOME, to: ["Hello"] },
    ]);
    await h.engine.refresh();

    expect(h.engine.getState().openNote?.path).toEqual(WELCOME);
    await settle(h.engine);
    expect(
      h.engine
        .getState()
        .notices.filter((notice) => notice.kind === "remote-relocated"),
    ).toEqual([]);
  });
});
