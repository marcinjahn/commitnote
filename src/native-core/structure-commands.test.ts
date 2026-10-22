import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sharesWithin } from "../share/share-index";
import { describeStructureError } from "../ui/browse/structure-messages";
import { describeShareError, messageText } from "../ui/share/share-messages";
import { describeRevokeFailed } from "../ui/trash/trash-messages";
import type { CoreEvents, NativeCoreHandle, TreeNode } from "./api";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const REPO = "sample/notes";
const WELCOME = ["Welcome"];
const COMMITNOTE = ["Projects", "commitnote"];

interface EngineProbe {
  shares: number;
  conflicts: number;
}

let ctx: CoreTestContext;

beforeEach(async () => {
  ctx = await createCoreTestContext({
    extraCommands: (app) => ({
      "test.share": async (params): Promise<unknown> => {
        const { path } = params as { path: string[] };
        const result = await app
          .current()!
          .services.shareService.createShare({ path, password: "" });
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      },
      "test.engine": async (): Promise<EngineProbe> => {
        const state = app.current()!.engine.getState();
        return {
          shares:
            state.shares === null ? 0 : sharesWithin(state.shares, []).length,
          conflicts: state.conflicts.length,
        };
      },
    }),
  });
});

afterEach(() => {
  ctx.dispose();
});

async function started(): Promise<NativeCoreHandle> {
  const core = ctx.startCore();
  await ctx.logIn(core);
  return core;
}

async function tree(core: NativeCoreHandle): Promise<TreeNode[]> {
  return (await ctx.call(core, "tree.get")).tree;
}

function findNode(nodes: TreeNode[], path: string[]): TreeNode | undefined {
  for (const node of nodes) {
    if (JSON.stringify(node.path) === JSON.stringify(path)) return node;
    if (node.kind === "folder") {
      const found = findNode(node.children, path);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

async function childNames(
  core: NativeCoreHandle,
  path: string[],
): Promise<string[]> {
  const nodes =
    path.length === 0 ? await tree(core) : findNode(await tree(core), path);
  const children = Array.isArray(nodes)
    ? nodes
    : nodes?.kind === "folder"
      ? nodes.children
      : [];
  return children.map((node) => node.name);
}

function notices(): CoreEvents["notice"][] {
  return ctx.events("notice") as CoreEvents["notice"][];
}

function clearedIds(): string[] {
  return (ctx.events("noticeCleared") as { id: string }[]).map(({ id }) => id);
}

async function probe(core: NativeCoreHandle): Promise<EngineProbe> {
  return ctx.call(core, "test.engine");
}

async function share(core: NativeCoreHandle, path: string[]): Promise<void> {
  expect(await ctx.call(core, "test.share", { path })).toEqual({ ok: true });
  expect((await probe(core)).shares).toBe(1);
}

async function makeConflict(core: NativeCoreHandle): Promise<void> {
  const { note } = await ctx.call(core, "note.open", { path: WELCOME });
  const rest = (note.content as string).split("\n").slice(1);
  await ctx.call(core, "note.edit", {
    path: WELCOME,
    text: ["Mine", ...rest].join("\n"),
  });
  await ctx.controls.editNote(
    REPO,
    WELCOME,
    ["Theirs", ...rest].join("\n"),
    undefined,
    "Other device",
  );
  await ctx.call(core, "sync.flush");
  expect((await probe(core)).conflicts).toBe(1);
}

describe("node.rename and node.move", () => {
  it("renames a note and reports a duplicate with the dialog copy", async () => {
    const core = await started();
    expect(
      await ctx.call(core, "node.rename", { path: WELCOME, name: "Hello" }),
    ).toStrictEqual({ outcome: { kind: "ok", path: ["Hello"] } });
    expect(await childNames(core, [])).toContain("Hello");
    expect(
      await ctx.call(core, "node.rename", {
        path: ["Hello"],
        name: "Zażółć gęślą jaźń",
      }),
    ).toStrictEqual({
      outcome: {
        kind: "error",
        message: describeStructureError({
          kind: "invalidName",
          error: { kind: "duplicate" },
        }),
      },
    });
  });

  it("moves a note into a folder without a notice", async () => {
    const core = await started();
    const before = notices().length;
    expect(
      await ctx.call(core, "node.move", { path: WELCOME, parent: COMMITNOTE }),
    ).toStrictEqual({
      outcome: { kind: "ok", path: [...COMMITNOTE, "Welcome"] },
    });
    expect(await childNames(core, COMMITNOTE)).toContain("Welcome");
    expect(notices()).toHaveLength(before);
  });

  it("rejects malformed params", async () => {
    const core = await started();
    for (const [command, params] of [
      ["node.rename", { path: [], name: "x" }],
      ["node.move", { path: WELCOME }],
      ["node.place", { path: WELCOME, parent: [] }],
      ["node.moveSibling", { path: WELCOME, direction: "left" }],
      ["node.setColorTag", { path: WELCOME, tag: "pink" }],
      ["node.trash", { path: WELCOME, shareCount: -1 }],
      ["node.trashPreview", { path: ["Missing"] }],
    ] as const) {
      expect(await ctx.send(core, command, params)).toMatchObject({
        ok: false,
        error: { kind: "invalidParams" },
      });
    }
  });
});

describe("node.place and node.moveSibling", () => {
  it("places across folders with an Undo notice that restores the order", async () => {
    const core = await started();
    expect(await childNames(core, COMMITNOTE)).toEqual(["Roadmap", "Ideas"]);
    expect(
      await ctx.call(core, "node.place", {
        path: [...COMMITNOTE, "Roadmap"],
        parent: ["Journal", "2026"],
        before: "January",
      }),
    ).toStrictEqual({
      outcome: { kind: "ok", path: ["Journal", "2026", "Roadmap"] },
    });
    expect(await childNames(core, ["Journal", "2026"])).toEqual([
      "Roadmap",
      "January",
      "Whiteboard",
    ]);
    const notice = notices().at(-1)!;
    expect(notice).toStrictEqual({
      id: notice.id,
      tone: "success",
      message: "“Roadmap” moved to “2026”",
      persistent: true,
      action: { kind: "undo", label: "Undo" },
    });

    expect(await ctx.call(core, "notices.perform", { id: notice.id })).toEqual(
      {},
    );
    expect(clearedIds()).toContain(notice.id);
    expect(await childNames(core, COMMITNOTE)).toEqual(["Roadmap", "Ideas"]);

    const count = notices().length;
    await ctx.call(core, "notices.perform", { id: notice.id });
    expect(await childNames(core, COMMITNOTE)).toEqual(["Roadmap", "Ideas"]);
    expect(notices()).toHaveLength(count);
  });

  it("reorders within the same parent without a notice", async () => {
    const core = await started();
    const before = notices().length;
    expect(
      await ctx.call(core, "node.place", {
        path: [...COMMITNOTE, "Ideas"],
        parent: COMMITNOTE,
        before: "Roadmap",
      }),
    ).toStrictEqual({
      outcome: { kind: "ok", path: [...COMMITNOTE, "Ideas"] },
    });
    expect(await childNames(core, COMMITNOTE)).toEqual(["Ideas", "Roadmap"]);
    expect(notices()).toHaveLength(before);
  });

  it("moves down with Undo and reports none at the edge", async () => {
    const core = await started();
    expect(
      await ctx.call(core, "node.moveSibling", {
        path: [...COMMITNOTE, "Roadmap"],
        direction: "up",
      }),
    ).toStrictEqual({ outcome: { kind: "none" } });
    expect(
      await ctx.call(core, "node.moveSibling", {
        path: [...COMMITNOTE, "Roadmap"],
        direction: "down",
      }),
    ).toStrictEqual({
      outcome: { kind: "ok", path: [...COMMITNOTE, "Roadmap"] },
    });
    expect(await childNames(core, COMMITNOTE)).toEqual(["Ideas", "Roadmap"]);
    const notice = notices().at(-1)!;
    expect(notice.message).toBe("“Roadmap” moved down");
    expect(notice.action).toEqual({ kind: "undo", label: "Undo" });

    await ctx.call(core, "node.moveSibling", {
      path: [...COMMITNOTE, "Roadmap"],
      direction: "up",
    });
    expect(clearedIds()).toContain(notice.id);
    const next = notices().at(-1)!;
    expect(next.message).toBe("“Roadmap” moved up");
    await ctx.call(core, "notices.dismiss", { id: next.id });
    expect(clearedIds()).toContain(next.id);
  });
});

describe("node.moveTargets", () => {
  it("leaves a folder and its descendants out and disables its parent", async () => {
    const core = await started();
    expect(
      await ctx.call(core, "node.moveTargets", { path: ["Projects"] }),
    ).toStrictEqual({
      targets: [
        { path: [], label: "Notes (top level)", depth: 0, disabled: true },
        {
          path: ["Empty folder"],
          label: "Empty folder",
          depth: 1,
          disabled: false,
        },
        { path: ["Journal"], label: "Journal", depth: 1, disabled: false },
        { path: ["Journal", "2026"], label: "2026", depth: 2, disabled: false },
      ],
    });
  });
});

describe("node.trashPreview and node.trash", () => {
  it("previews a folder with its item count", async () => {
    const core = await started();
    expect(
      await ctx.call(core, "node.trashPreview", { path: ["Projects"] }),
    ).toStrictEqual({
      preview: {
        title: "Move to trash?",
        message:
          "“Projects” and everything in it (3 items) will be moved to the trash.\n\nItems in the trash are deleted permanently after 30 days.",
        confirmLabel: "Move to trash",
        itemCount: 3,
        shareCount: 0,
      },
    });
  });

  it("trashes the open note and Undo restores and reopens it", async () => {
    const core = await started();
    await ctx.call(core, "note.open", { path: WELCOME });
    const result = await ctx.call(core, "node.trash", {
      path: WELCOME,
      shareCount: 0,
    });
    expect(result).toStrictEqual({
      outcome: { kind: "trashed", entryId: expect.any(String) },
    });
    expect(await childNames(core, [])).not.toContain("Welcome");
    const notice = notices().at(-1)!;
    expect(notice).toMatchObject({
      tone: "success",
      message: "“Welcome” moved to trash",
      persistent: true,
      action: { kind: "undo", label: "Undo" },
    });

    await ctx.call(core, "notices.perform", { id: notice.id });
    expect(await childNames(core, [])).toContain("Welcome");
    expect(
      (ctx.events("noteChanged") as CoreEvents["noteChanged"][]).at(-1)?.note,
    ).toMatchObject({ state: "loaded", path: WELCOME });
  });

  it("deletes an empty folder permanently without a notice", async () => {
    const core = await started();
    expect(
      (await ctx.call(core, "node.trashPreview", { path: ["Empty folder"] }))
        .preview,
    ).toMatchObject({ title: "Delete folder?", confirmLabel: "Delete" });
    const before = notices().length;
    expect(
      await ctx.call(core, "node.trash", {
        path: ["Empty folder"],
        shareCount: 0,
      }),
    ).toStrictEqual({ outcome: { kind: "deleted" } });
    expect(await childNames(core, [])).not.toContain("Empty folder");
    expect(notices()).toHaveLength(before);
  });

  it("asks again when the note became shared and revokes the confirmed share", async () => {
    const core = await started();
    await share(core, WELCOME);
    const { preview } = await ctx.call(core, "node.trashPreview", {
      path: WELCOME,
    });
    expect(preview).toMatchObject({
      confirmLabel: "Revoke links and move to trash",
      shareCount: 1,
    });

    expect(
      await ctx.call(core, "node.trash", { path: WELCOME, shareCount: 0 }),
    ).toStrictEqual({ outcome: { kind: "confirm", preview } });
    expect((await probe(core)).shares).toBe(1);
    expect(await childNames(core, [])).toContain("Welcome");

    expect(
      (await ctx.call(core, "node.trash", { path: WELCOME, shareCount: 1 }))
        .outcome.kind,
    ).toBe("trashed");
    expect((await probe(core)).shares).toBe(0);
    expect(await childNames(core, [])).not.toContain("Welcome");
  });

  it("trashes nothing when revoking fails", async () => {
    const core = await started();
    await share(core, WELCOME);
    ctx.controls.failNext(REPO, "deleteShare", "Network");
    expect(
      await ctx.call(core, "node.trash", { path: WELCOME, shareCount: 1 }),
    ).toStrictEqual({
      outcome: {
        kind: "error",
        message: describeRevokeFailed(
          messageText(describeShareError({ kind: "network" }, "github")),
          0,
        ),
      },
    });
    expect((await probe(core)).shares).toBe(1);
    expect(await childNames(core, [])).toContain("Welcome");
  });

  it("refuses a conflicted shared note before revoking", async () => {
    const core = await started();
    await share(core, WELCOME);
    await makeConflict(core);
    expect(
      await ctx.call(core, "node.trash", { path: WELCOME, shareCount: 1 }),
    ).toStrictEqual({
      outcome: {
        kind: "error",
        message: describeStructureError({ kind: "conflicted" }),
      },
    });
    expect((await probe(core)).shares).toBe(1);
  });
});

describe("node.setColorTag", () => {
  it("shows the tag in treeChanged and clears it again", async () => {
    const core = await started();
    expect(
      await ctx.call(core, "node.setColorTag", { path: WELCOME, tag: "red" }),
    ).toStrictEqual({ outcome: { kind: "ok", path: WELCOME } });
    const latest = (
      ctx.events("treeChanged") as CoreEvents["treeChanged"][]
    ).at(-1)!.tree!;
    expect(findNode(latest, WELCOME)).toStrictEqual({
      kind: "note",
      name: "Welcome",
      path: WELCOME,
      colorTag: "red",
      shared: false,
    });
    await ctx.call(core, "node.setColorTag", { path: WELCOME, tag: null });
    expect(findNode(await tree(core), WELCOME)).toMatchObject({
      colorTag: null,
    });
    expect(findNode(await tree(core), [...COMMITNOTE, "Ideas"])).toMatchObject({
      colorTag: "green",
    });
  });
});

describe("open note tag and share state", () => {
  function lastNote(): CoreEvents["noteChanged"]["note"] {
    return (ctx.events("noteChanged") as CoreEvents["noteChanged"][]).at(-1)!
      .note;
  }

  it("carries the real tag and shared state while the tag filter hides the note", async () => {
    const core = await started();
    await share(core, WELCOME);
    await ctx.call(core, "node.setColorTag", { path: WELCOME, tag: "red" });
    await ctx.call(core, "tags.setFilter", { tag: "green" });
    await vi.waitFor(() =>
      expect(
        (
          ctx.events("treeChanged") as CoreEvents["treeChanged"][]
        ).at(-1)!.tagFilter,
      ).toBe("green"),
    );
    const filtered = (
      ctx.events("treeChanged") as CoreEvents["treeChanged"][]
    ).at(-1)!.tree!;
    expect(findNode(filtered, WELCOME)).toBeUndefined();

    await ctx.call(core, "note.open", { path: WELCOME });
    await vi.waitFor(() =>
      expect(lastNote()).toMatchObject({
        state: "loaded",
        path: WELCOME,
        colorTag: "red",
        shared: true,
      }),
    );

    await ctx.call(core, "node.setColorTag", { path: WELCOME, tag: "blue" });
    await vi.waitFor(() =>
      expect(lastNote()).toMatchObject({ path: WELCOME, colorTag: "blue" }),
    );
  });
});
