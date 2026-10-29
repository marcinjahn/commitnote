import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../testing/sample-notes-repo/sample-source";
import { RESULT_CAP, SOURCE_REFRESH_THROTTLE_MS } from "../search/search-tuning";
import {
  NAME_SECTION_HEADING,
  RECENT_SECTION_HEADING,
  SEARCH_HINT,
  STILL_READING,
  contentSectionHeading,
  describeNoMatches,
  describeShowingFirst,
} from "../ui/search/search-messages";
import type { CoreEvents, NativeCoreHandle, TreeNode } from "./api";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

let ctx: CoreTestContext;

beforeEach(async () => {
  ctx = await createCoreTestContext();
});

afterEach(() => {
  ctx.dispose();
});

async function startedOn(repo: string): Promise<NativeCoreHandle> {
  const core = ctx.startCore();
  await ctx.inspect(core, repo);
  expect(
    await ctx.call(core, "login.unlock", {
      passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
    }),
  ).toEqual({ kind: "loggedIn" });
  return core;
}

function trashEvents(): CoreEvents["trashChanged"][] {
  return ctx.events("trashChanged") as CoreEvents["trashChanged"][];
}

function treeEvents(): CoreEvents["treeChanged"][] {
  return ctx.events("treeChanged") as CoreEvents["treeChanged"][];
}

function lastTree(): CoreEvents["treeChanged"] {
  return treeEvents().at(-1)!;
}

function noteNames(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "note" ? [node.name] : noteNames(node.children),
  );
}

async function treeOf(core: NativeCoreHandle): Promise<TreeNode[]> {
  return (await ctx.call(core, "tree.get")).tree;
}

describe("trash", () => {
  it("lists only unexpired entries with their location and days left", async () => {
    await startedOn("sample/trash");
    await vi.waitFor(() => expect(trashEvents().length).toBeGreaterThan(0));
    const { entries, deleteConfirmation, emptyConfirmation } =
      trashEvents().at(-1)!;
    expect(entries).toStrictEqual([
      {
        id: entries[0]!.id,
        kind: "note",
        name: "Scratch",
        originalFolder: "Notes (top level)",
        daysLeft: expect.stringMatching(/\d+ days? left/),
        colorTag: null,
        children: [],
      },
    ]);
    expect(deleteConfirmation).toStrictEqual({
      title: "Delete permanently?",
      message: "This can't be undone.",
    });
    expect(emptyConfirmation.title).toBe("Empty trash?");
  });

  it("restores a whole entry to a chosen folder", async () => {
    const core = await startedOn("sample/trash");
    await vi.waitFor(() => expect(trashEvents().length).toBeGreaterThan(0));
    const [entry] = trashEvents().at(-1)!.entries;
    const { targets } = await ctx.call(core, "trash.restoreTargets", {
      entryId: entry!.id,
      subPath: [],
    });
    expect(targets[0]).toStrictEqual({
      path: [],
      label: "Notes (top level)",
      depth: 0,
      disabled: false,
    });
    expect(targets.map((target: { label: string }) => target.label)).toContain(
      "Archive",
    );
    expect(
      await ctx.call(core, "trash.restore", {
        entryId: entry!.id,
        subPath: [],
        parent: ["Archive"],
      }),
    ).toStrictEqual({ outcome: { kind: "ok", path: ["Archive", "Scratch"] } });
    expect(noteNames(await treeOf(core))).toContain("Scratch");
    await vi.waitFor(() =>
      expect(trashEvents().at(-1)!.entries).toStrictEqual([]),
    );
  });

  it("restores a sub-item of a trashed folder", async () => {
    const core = await startedOn("sample/notes");
    const folder = ["Projects", "commitnote"];
    const { preview } = await ctx.call(core, "node.trashPreview", {
      path: folder,
    });
    expect(
      await ctx.call(core, "node.trash", {
        path: folder,
        shareCount: preview.shareCount,
      }),
    ).toMatchObject({ outcome: { kind: "trashed" } });
    await vi.waitFor(() => expect(trashEvents().at(-1)!.entries).toHaveLength(1));
    const [entry] = trashEvents().at(-1)!.entries;
    expect(entry).toMatchObject({ kind: "folder", name: "commitnote" });
    const roadmap = entry!.children.find((child) => child.name === "Roadmap")!;
    expect(roadmap).toStrictEqual({
      kind: "note",
      name: "Roadmap",
      subPath: ["Roadmap"],
      children: [],
    });
    expect(
      await ctx.call(core, "trash.restore", {
        entryId: entry!.id,
        subPath: roadmap.subPath,
        parent: ["Journal"],
      }),
    ).toStrictEqual({ outcome: { kind: "ok", path: ["Journal", "Roadmap"] } });
    expect(noteNames(await treeOf(core))).toContain("Roadmap");
    await vi.waitFor(() => {
      const [remaining] = trashEvents().at(-1)!.entries;
      expect(remaining!.children.map((child) => child.name)).not.toContain(
        "Roadmap",
      );
    });
  });

  it("rejects unknown entries", async () => {
    const core = await startedOn("sample/trash");
    expect(
      await ctx.send(core, "trash.restoreTargets", {
        entryId: "missing",
        subPath: [],
      }),
    ).toMatchObject({ ok: false, error: { kind: "invalidParams" } });
  });

  it("deletes one entry permanently", async () => {
    const core = await startedOn("sample/trash");
    await vi.waitFor(() => expect(trashEvents().length).toBeGreaterThan(0));
    const [entry] = trashEvents().at(-1)!.entries;
    expect(await ctx.call(core, "trash.delete", { entryId: entry!.id })).toEqual(
      {},
    );
    await vi.waitFor(() =>
      expect(trashEvents().at(-1)!.entries).toStrictEqual([]),
    );
    expect(noteNames(await treeOf(core))).not.toContain("Scratch");
  });

  it("empties the trash", async () => {
    const core = await startedOn("sample/notes");
    await ctx.call(core, "node.trash", { path: ["Welcome"], shareCount: 0 });
    await ctx.call(core, "node.trash", {
      path: ["Zażółć gęślą jaźń"],
      shareCount: 0,
    });
    await vi.waitFor(() => expect(trashEvents().at(-1)!.entries).toHaveLength(2));
    expect(trashEvents().at(-1)!.emptyConfirmation.message).toContain("2");
    expect(await ctx.call(core, "trash.empty")).toEqual({});
    await vi.waitFor(() =>
      expect(trashEvents().at(-1)!.entries).toStrictEqual([]),
    );
  });
});

describe("tag filter", () => {
  it("reports the palette and the used tags", async () => {
    await startedOn("sample/notes");
    await vi.waitFor(() => expect(treeEvents().length).toBeGreaterThan(0));
    const event = lastTree();
    expect(event.tagFilter).toBeNull();
    expect(event.usedTags).toStrictEqual(["orange", "green", "blue", "purple"]);
    expect(event.tagsWritable).toBe(true);
    expect(event.tagOptions.map((option) => option.tag)).toStrictEqual([
      "red",
      "orange",
      "yellow",
      "green",
      "blue",
      "purple",
    ]);
    expect(event.tagOptions[0]).toStrictEqual({ tag: "red", label: "Red" });
  });

  it("filters the tree by a tag set through node.setColorTag", async () => {
    const core = await startedOn("sample/notes");
    expect(
      await ctx.call(core, "node.setColorTag", { path: ["Welcome"], tag: "red" }),
    ).toStrictEqual({ outcome: { kind: "ok", path: ["Welcome"] } });
    await vi.waitFor(() => expect(lastTree().usedTags).toContain("red"));
    expect(await ctx.call(core, "tags.setFilter", { tag: "red" })).toEqual({});
    await vi.waitFor(() => expect(lastTree().tagFilter).toBe("red"));
    expect(noteNames(lastTree().tree!)).toStrictEqual(["Welcome"]);
    expect(noteNames(await treeOf(core)).length).toBeGreaterThan(1);

    await ctx.call(core, "tags.setFilter", { tag: null });
    await vi.waitFor(() => expect(lastTree().tagFilter).toBeNull());
    expect(noteNames(lastTree().tree!).length).toBeGreaterThan(1);
  });

  it("resets the filter when no note uses the tag any more", async () => {
    const core = await startedOn("sample/notes");
    const purple = ["Zażółć gęślą jaźń"];
    await ctx.call(core, "tags.setFilter", { tag: "purple" });
    await vi.waitFor(() => expect(lastTree().tagFilter).toBe("purple"));
    expect(noteNames(lastTree().tree!)).toStrictEqual(purple);

    await ctx.call(core, "node.setColorTag", { path: purple, tag: null });
    await vi.waitFor(() => expect(lastTree().tagFilter).toBeNull());
    expect(lastTree().usedTags).not.toContain("purple");
    expect(noteNames(lastTree().tree!).length).toBeGreaterThan(1);
  });

  it("ignores a filter for a tag nobody uses", async () => {
    const core = await startedOn("sample/notes");
    await ctx.call(core, "tags.setFilter", { tag: "red" });
    expect(lastTree().tagFilter).toBeNull();
    expect(
      await ctx.send(core, "tags.setFilter", { tag: "pink" }),
    ).toMatchObject({ ok: false, error: { kind: "invalidParams" } });
  });

  async function filtered(): Promise<NativeCoreHandle> {
    const core = await startedOn("sample/notes");
    await ctx.call(core, "tags.setFilter", { tag: "purple" });
    await vi.waitFor(() => expect(lastTree().tagFilter).toBe("purple"));
    return core;
  }

  it("is cleared by draft.start", async () => {
    const core = await filtered();
    await ctx.call(core, "draft.start", { parent: [] });
    await vi.waitFor(() => expect(lastTree().tagFilter).toBeNull());
  });

  it("is cleared by a draft that becomes a note", async () => {
    const core = await filtered();
    await ctx.call(core, "draft.start", { parent: [] });
    await vi.waitFor(() => expect(lastTree().tagFilter).toBeNull());
    await ctx.call(core, "tags.setFilter", { tag: "purple" });
    await vi.waitFor(() => expect(lastTree().tagFilter).toBe("purple"));
    const { outcome } = await ctx.call(core, "draft.content", {
      name: "Fresh",
      content: "text",
    });
    expect(outcome.kind).toBe("created");
    await vi.waitFor(() => expect(lastTree().tagFilter).toBeNull());
    expect(noteNames(lastTree().tree!)).toContain("Fresh");
  });

  it("is cleared by folder.create", async () => {
    const core = await filtered();
    await ctx.call(core, "folder.create", { parent: [], name: "Fresh folder" });
    await vi.waitFor(() => expect(lastTree().tagFilter).toBeNull());
  });
});

describe("search", () => {
  async function opened(): Promise<NativeCoreHandle> {
    const core = await startedOn("sample/search");
    await ctx.call(core, "search.open");
    return core;
  }

  async function query(core: NativeCoreHandle, text: string) {
    return (await ctx.call(core, "search.query", { query: text })).results;
  }

  it("returns recent notes for a blank query, excluding the open note", async () => {
    const core = await opened();
    await ctx.call(core, "note.open", { path: ["Welcome"] });
    await ctx.call(core, "note.open", { path: ["Recipes", "Pierogi"] });
    const results = await query(core, "  ");
    expect(results.names).toStrictEqual([]);
    expect(results.contents).toStrictEqual([]);
    expect(results.countText).toBeNull();
    expect(results.recent).toStrictEqual([
      {
        path: ["Welcome"],
        name: "Welcome",
        folder: null,
        nameRanges: [],
        snippet: null,
        colorTag: null,
      },
    ]);
  });

  it("matches note names with highlighted ranges and folder text", async () => {
    const core = await opened();
    const results = await query(core, "road");
    expect(results.recent).toStrictEqual([]);
    expect(results.names).toStrictEqual([
      {
        path: ["Projects", "commitnote", "Roadmap"],
        name: "Roadmap",
        folder: "Projects / commitnote",
        nameRanges: [[0, 4]],
        snippet: null,
        colorTag: "blue",
      },
    ]);
    expect(results.countText).toMatch(/result/);
  });

  it("matches contents with snippet segments", async () => {
    const core = await opened();
    await vi.waitFor(async () => {
      const results = await query(core, "lighthouse");
      expect(
        results.contents.map((row: { name: string }) => row.name).sort(),
      ).toStrictEqual(["February", "January", "Lisbon", "Reading list", "Welcome"]);
    });
    const results = await query(core, "lighthouse");
    const lisbon = results.contents.find(
      (row: { name: string }) => row.name === "Lisbon",
    );
    expect(lisbon.folder).toBe("Journal / Trips");
    expect(lisbon.snippet.some((part: { match: boolean }) => part.match)).toBe(
      true,
    );
    expect(
      lisbon.snippet
        .filter((part: { match: boolean }) => part.match)
        .map((part: { text: string }) => part.text.toLowerCase()),
    ).toStrictEqual(["lighthouse"]);
    expect(results.countText).toBe("5 results");
  });

  it("supplies the screen copy from the web helpers", async () => {
    const core = await opened();
    await vi.waitFor(async () => {
      expect((await query(core, "")).copy).toStrictEqual({
        recentHeading: RECENT_SECTION_HEADING,
        namesHeading: NAME_SECTION_HEADING,
        contentsHeading: contentSectionHeading(false),
        noMatches: "",
        stillReading: STILL_READING,
        hint: SEARCH_HINT,
      });
    });
    expect((await query(core, "  zzqx ")).copy.noMatches).toBe(
      describeNoMatches("zzqx"),
    );
  });

  it("marks a section as capped only when more than the cap matches", async () => {
    const core = await opened();
    const small = await query(core, "road");
    expect(small.namesMore).toBeNull();
    expect(small.contentsMore).toBeNull();
    for (let index = 0; index <= RESULT_CAP; index++) {
      await ctx.call(core, "draft.start", { parent: [] });
      await ctx.call(core, "draft.commitName", { name: `Quokka ${index}` });
    }
    ctx.clock.advance(SOURCE_REFRESH_THROTTLE_MS + 1);
    const capped = await query(core, "quokka");
    expect(capped.names).toHaveLength(RESULT_CAP);
    expect(capped.namesMore).toBe(describeShowingFirst(RESULT_CAP));
    expect((await query(core, "quokka")).contentsMore).toBeNull();
  });

  it("reports the indexer status until it completes and stops after close", async () => {
    const core = await opened();
    const statuses = () =>
      ctx.events("searchStatusChanged") as CoreEvents["searchStatusChanged"][];
    expect(statuses().length).toBeGreaterThan(0);
    await vi.waitFor(() =>
      expect(statuses().at(-1)).toStrictEqual({
        status: null,
        progress: null,
        partial: false,
      }),
    );
    const before = statuses().length;
    expect(await ctx.call(core, "search.close")).toEqual({});
    await ctx.call(core, "node.rename", { path: ["Welcome"], name: "Hello" });
    expect(statuses()).toHaveLength(before);
  });
});
