import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NativeCoreHandle } from "./api";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const REPO = "sample/notes";

let ctx: CoreTestContext;

beforeEach(async () => {
  ctx = await createCoreTestContext({
    extraCommands: (app) => ({
      "test.changeSettings": async (params): Promise<{}> => {
        const { edits } = params as { edits: Record<string, unknown> };
        app.current()!.engine.changeSettings(edits);
        await app.current()!.engine.flush();
        return {};
      },
      "test.openPath": async (): Promise<{ path: string[] | null }> => {
        const open = app.current()?.engine.getState().openNote;
        return { path: open === undefined || open === null ? null : [...open.path] };
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

async function rootNames(core: NativeCoreHandle): Promise<string[]> {
  const { tree } = await ctx.call(core, "tree.get");
  return tree.map((node: { name: string }) => node.name);
}

async function committedRootNames(): Promise<string[]> {
  const reader = ctx.startCore();
  await ctx.logIn(reader);
  const names = await rootNames(reader);
  reader.stop();
  return names;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function autoNameNow(): string {
  const now = new Date(ctx.clock.now());
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

describe("draft.start and draft.commitName", () => {
  it("creates the note at the beginning of the root order and opens it", async () => {
    const core = await started();
    const before = ctx.controls.commitMessages(REPO).length;
    expect(await ctx.call(core, "draft.start", { parent: [] })).toEqual({
      draft: { parent: [], name: "" },
    });
    expect(
      await ctx.call(core, "draft.commitName", { name: "Plans" }),
    ).toEqual({ outcome: { kind: "created", path: ["Plans"], fieldError: null } });
    expect((await rootNames(core))[0]).toBe("Plans");
    expect(await ctx.call(core, "test.openPath")).toEqual({ path: ["Plans"] });
    await ctx.call(core, "sync.flush");
    expect(ctx.controls.commitMessages(REPO).length).toBe(before + 1);
    expect((await committedRootNames())[0]).toBe("Plans");
    expect(
      await ctx.call(core, "draft.commitName", { name: "Again" }),
    ).toEqual({ outcome: { kind: "none" } });
  });

  it("places the note last with newNotePlacement end", async () => {
    const core = await started();
    await ctx.call(core, "test.changeSettings", {
      edits: { newNotePlacement: "end" },
    });
    await ctx.call(core, "draft.start", { parent: [] });
    await ctx.call(core, "draft.commitName", { name: "Plans" });
    const names = await rootNames(core);
    expect(names[names.length - 1]).toBe("Plans");
  });

  it("keeps the draft after a duplicate name error", async () => {
    const core = await started();
    await ctx.call(core, "draft.start", { parent: [] });
    expect(
      await ctx.call(core, "draft.commitName", { name: "Welcome" }),
    ).toEqual({
      outcome: {
        kind: "error",
        message: "A note or folder with this name already exists here.",
      },
    });
    expect(
      await ctx.call(core, "draft.commitName", { name: "Fresh" }),
    ).toMatchObject({ outcome: { kind: "created", path: ["Fresh"] } });
  });

  it("answers none for a blank name", async () => {
    const core = await started();
    await ctx.call(core, "draft.start", { parent: [] });
    expect(await ctx.call(core, "draft.commitName", { name: "  " })).toEqual({
      outcome: { kind: "none" },
    });
  });

  it("rejects a missing parent", async () => {
    const core = await started();
    expect(
      await ctx.send(core, "draft.start", { parent: ["Nope"] }),
    ).toMatchObject({ ok: false, error: { kind: "invalidParams" } });
    expect(await ctx.send(core, "draft.start", { parent: "x" })).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
  });
});

describe("draft.content", () => {
  it("creates under an auto name and a second draft gets a suffix", async () => {
    const core = await started();
    const name = autoNameNow();
    await ctx.call(core, "draft.start", { parent: [] });
    expect(
      await ctx.call(core, "draft.content", { name: "", content: "Hello" }),
    ).toEqual({
      outcome: { kind: "created", path: [name], fieldError: null },
    });
    await ctx.call(core, "draft.start", { parent: [] });
    expect(
      await ctx.call(core, "draft.content", { name: "", content: "Again" }),
    ).toMatchObject({
      outcome: { kind: "created", path: [`${name} (2)`] },
    });
    const { note } = await ctx.call(core, "note.open", { path: [name] });
    expect(note.content).toBe("Hello");
  });

  it("falls back to the auto name with a field error for an invalid name", async () => {
    const core = await started();
    const name = autoNameNow();
    await ctx.call(core, "draft.start", { parent: [] });
    expect(
      await ctx.call(core, "draft.content", { name: "a/b", content: "Body" }),
    ).toEqual({
      outcome: {
        kind: "created",
        path: [name],
        fieldError: "Names can't contain “/”.",
      },
    });
    const { note } = await ctx.call(core, "note.open", { path: [name] });
    expect(note.content).toBe("Body");
  });

  it("uses the typed name when it is valid", async () => {
    const core = await started();
    await ctx.call(core, "draft.start", { parent: ["Journal"] });
    expect(
      await ctx.call(core, "draft.content", { name: "Day", content: "x" }),
    ).toEqual({
      outcome: { kind: "created", path: ["Journal", "Day"], fieldError: null },
    });
  });
});

describe("draft.leave", () => {
  it("discards the draft without committing", async () => {
    const core = await started();
    const before = ctx.controls.commitMessages(REPO).length;
    const names = await rootNames(core);
    await ctx.call(core, "draft.start", { parent: [] });
    expect(await ctx.call(core, "draft.leave")).toEqual({});
    for (const [command, params] of [
      ["draft.commitName", { name: "Plans" }],
      ["draft.content", { name: "", content: "x" }],
    ] as const) {
      expect(await ctx.call(core, command, params)).toEqual({
        outcome: { kind: "none" },
      });
    }
    await ctx.call(core, "sync.flush");
    expect(ctx.controls.commitMessages(REPO).length).toBe(before);
    expect(await rootNames(core)).toEqual(names);
  });

  it("is discarded by note.open", async () => {
    const core = await started();
    await ctx.call(core, "draft.start", { parent: [] });
    await ctx.call(core, "note.open", { path: ["Welcome"] });
    expect(
      await ctx.call(core, "draft.commitName", { name: "Plans" }),
    ).toEqual({ outcome: { kind: "none" } });
  });

  it("is discarded by logout", async () => {
    const core = await started();
    await ctx.call(core, "draft.start", { parent: [] });
    await ctx.call(core, "session.logout", { anyway: false });
    await ctx.logIn(core);
    expect(
      await ctx.call(core, "draft.content", { name: "", content: "x" }),
    ).toEqual({ outcome: { kind: "none" } });
  });

  it("answers notReady without a running app", async () => {
    const core = ctx.startCore();
    for (const [command, params] of [
      ["draft.start", { parent: [] }],
      ["draft.commitName", { name: "x" }],
      ["draft.content", { name: "", content: "x" }],
      ["folder.create", { parent: [], name: "x" }],
    ] as const) {
      expect(await ctx.send(core, command, params)).toMatchObject({
        ok: false,
        error: { kind: "notReady" },
      });
    }
    expect(await ctx.call(core, "draft.leave")).toEqual({});
  });
});

describe("folder.create", () => {
  it("creates a folder and commits its keep file", async () => {
    const core = await started();
    const paths = await ctx.controls.headPaths(REPO);
    const before = ctx.controls.commitMessages(REPO).length;
    expect(
      await ctx.call(core, "folder.create", { parent: [], name: "Ideas" }),
    ).toEqual({ outcome: { kind: "created", path: ["Ideas"] } });
    await ctx.call(core, "sync.flush");
    expect(ctx.controls.commitMessages(REPO).length).toBe(before + 1);
    expect((await ctx.controls.headPaths(REPO)).length).toBeGreaterThan(
      paths.length,
    );
    expect(await committedRootNames()).toContain("Ideas");
  });

  it("reports a duplicate name", async () => {
    const core = await started();
    expect(
      await ctx.call(core, "folder.create", { parent: [], name: "Journal" }),
    ).toEqual({
      outcome: {
        kind: "error",
        message: "A note or folder with this name already exists here.",
      },
    });
  });

  it("honours newFolderPlacement afterLastFolder", async () => {
    const core = await started();
    await ctx.call(core, "test.changeSettings", {
      edits: { newFolderPlacement: "afterLastFolder" },
    });
    await ctx.call(core, "folder.create", { parent: [], name: "Ideas" });
    const { tree } = await ctx.call(core, "tree.get");
    const kinds = tree.map((node: { kind: string }) => node.kind);
    const index = tree.findIndex((node: { name: string }) => node.name === "Ideas");
    expect(kinds[index - 1]).toBe("folder");
    expect(kinds[index + 1]).toBe("note");
  });

  it("validates its params", async () => {
    const core = await started();
    expect(
      await ctx.send(core, "folder.create", { parent: [], name: 1 }),
    ).toMatchObject({ ok: false, error: { kind: "invalidParams" } });
  });
});
