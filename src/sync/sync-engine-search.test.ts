import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Keyring } from "../crypto/keyring";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { findNode } from "../tree/note-tree";
import type { SearchSource } from "./search-source";
import { createSyncEngine, type SyncEngine } from "./sync-engine";
import {
  WELCOME,
  ZAZOLC,
  mainContent,
  mainTree,
  pushRemote,
  waitIdle,
} from "./testing/engine-harness";
import { createTestClock } from "./testing/test-clock";
import type { WorkingFolder } from "./working-tree";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly engine: SyncEngine;
  readonly reads: string[];
}

async function setup(): Promise<Harness> {
  const fake = await createSampleNotesRepoAdapter();
  const reads: string[] = [];
  const clock = createTestClock(1_000_000);
  const engine = createSyncEngine({
    adapter: delegateAdapter(fake, {
      readBlob: (sha) => {
        reads.push(sha);
        return fake.readBlob(sha);
      },
    }),
    keyring,
    clock,
  });
  await engine.refresh();
  return { fake, clock, engine, reads };
}

function sourceAt(
  engine: SyncEngine,
  path: readonly string[],
): SearchSource | undefined {
  return engine
    .searchSources()
    .find((source) => source.path.join("/") === path.join("/"));
}

function sidebarOrder(folder: WorkingFolder): string[][] {
  return folder.children.flatMap((child) =>
    child.kind === "folder" ? sidebarOrder(child) : [[...child.path]],
  );
}

describe("sync engine search sources", () => {
  it("is empty before the first refresh", async () => {
    const engine = createSyncEngine({
      adapter: await createSampleNotesRepoAdapter(),
      keyring,
      clock: createTestClock(1_000_000),
    });
    expect(engine.searchSources()).toEqual([]);
  });

  it("lists every live note in sidebar order with name and colour tag", async () => {
    const h = await setup();
    const tree = h.engine.getState().workingTree!;

    const sources = h.engine.searchSources();

    expect(sources.map((source) => [...source.path])).toEqual(
      sidebarOrder(tree.root),
    );
    expect(sources.length).toBeGreaterThan(2);
    for (const source of sources) {
      expect(source.name).toBe(source.path[source.path.length - 1]);
    }
    expect(sourceAt(h.engine, ZAZOLC)?.colorTag).toBe("purple");
    expect(sourceAt(h.engine, WELCOME)?.colorTag).toBeNull();
  });

  it("yields the synced blob SHA for an unedited note", async () => {
    const h = await setup();
    const node = findNode(await mainTree(h.fake, keyring), WELCOME);
    if (node?.kind !== "note") throw new Error("expected a note");

    expect(sourceAt(h.engine, WELCOME)?.content).toEqual({
      kind: "blob",
      blobSha: node.blobSha,
    });
  });

  it("yields the typed text for a pending edit", async () => {
    const h = await setup();

    h.engine.editNote(WELCOME, "typed text");

    expect(sourceAt(h.engine, WELCOME)?.content).toEqual({
      kind: "local",
      text: "typed text",
    });
  });

  it("keeps yielding the typed text while the save is in flight", async () => {
    const h = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedEngine = createSyncEngine({
      adapter: delegateAdapter(h.fake, {
        commit: async (request) => {
          await gate;
          return h.fake.commit(request);
        },
      }),
      keyring,
      clock: h.clock,
    });
    await gatedEngine.refresh();

    gatedEngine.editNote(WELCOME, "in flight");
    h.clock.advance(2_000);
    await vi.waitFor(() =>
      expect(gatedEngine.getState().save.kind).toBe("saving"),
    );

    expect(sourceAt(gatedEngine, WELCOME)?.content).toEqual({
      kind: "local",
      text: "in flight",
    });
    release();
    await waitIdle(gatedEngine);
  });

  it("prefers the text being edited in a held conflict", async () => {
    const h = await setup();
    const original = (await mainContent(h.fake, WELCOME))!;
    await pushRemote(h.fake, [
      {
        kind: "update-note",
        path: WELCOME,
        content: original.replace("# Welcome", "# Welcome (theirs)"),
      },
    ]);
    h.engine.editNote(
      WELCOME,
      original.replace("# Welcome", "# Welcome (mine)"),
    );
    await h.engine.flush();
    h.engine.resolveConflict(WELCOME, "editMerged");

    const merged = h.engine.getState().conflicts[0].merged;
    const editing = `${merged}\nmore`;
    h.engine.editNote(WELCOME, editing);

    expect(h.engine.getState().conflicts).toHaveLength(1);
    expect(sourceAt(h.engine, WELCOME)?.content).toEqual({
      kind: "local",
      text: editing,
    });
  });

  it("drops a trashed note", async () => {
    const h = await setup();
    const before = h.engine.searchSources().length;

    expect(h.engine.delete(WELCOME)).toMatchObject({ ok: true });

    expect(sourceAt(h.engine, WELCOME)).toBeUndefined();
    expect(h.engine.searchSources()).toHaveLength(before - 1);
  });

  it("performs no blob reads and does not notify subscribers", async () => {
    const h = await setup();
    h.reads.length = 0;
    const listener = vi.fn();
    h.engine.subscribe(listener);
    listener.mockClear();

    h.engine.searchSources();

    expect(h.reads).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("reads decrypted markdown by blob SHA without notifying subscribers", async () => {
    const h = await setup();
    const source = sourceAt(h.engine, WELCOME)!;
    if (source.content.kind !== "blob") throw new Error("expected a blob");
    const listener = vi.fn();
    h.engine.subscribe(listener);
    listener.mockClear();
    const stateBefore = h.engine.getState();

    const text = await h.engine.readNoteText(source.content.blobSha);

    expect(text).toBe(await mainContent(h.fake, WELCOME));
    expect(listener).not.toHaveBeenCalled();
    expect(h.engine.getState()).toBe(stateBefore);
  });
});
