import { unzipSync, strFromU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeLogoutUnsaved } from "../ui/session/session-messages";
import type { NativeCoreHandle } from "./api";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const REPO = "sample/notes";
const WELCOME = ["Welcome"];
const EDIT_DEBOUNCE_MS = 2_000;

interface EngineProbe {
  conflicts: number;
  unsaved: number;
}

let ctx: CoreTestContext;

beforeEach(async () => {
  ctx = await createCoreTestContext({
    extraCommands: (app) => ({
      "test.engine": async (): Promise<EngineProbe> => {
        const state = app.current()?.engine.getState();
        return {
          conflicts: state?.conflicts.length ?? 0,
          unsaved: state?.syncStates.unsavedCount ?? 0,
        };
      },
    }),
  });
});

afterEach(() => {
  ctx.dispose();
});

function commitCount(): number {
  return ctx.controls.commitMessages(REPO).length;
}

async function started(): Promise<NativeCoreHandle> {
  const core = ctx.startCore();
  await ctx.logIn(core);
  return core;
}

async function openWelcome(core: NativeCoreHandle): Promise<string> {
  const { note } = await ctx.call(core, "note.open", { path: WELCOME });
  return note.content;
}

async function committedWelcome(): Promise<string> {
  const reader = ctx.startCore();
  await ctx.logIn(reader);
  const text = await openWelcome(reader);
  reader.stop();
  return text;
}

async function probe(core: NativeCoreHandle): Promise<EngineProbe> {
  return ctx.call(core, "test.engine");
}

async function makeConflict(
  core: NativeCoreHandle,
): Promise<{ mine: string; theirs: string }> {
  const original = await openWelcome(core);
  const lines = original.split("\n");
  const mine = ["Mine first line", ...lines.slice(1)].join("\n");
  const theirs = ["Their first line", ...lines.slice(1)].join("\n");
  await ctx.call(core, "note.edit", { path: WELCOME, text: mine });
  await ctx.controls.editNote(REPO, WELCOME, theirs, undefined, "Other device");
  await ctx.call(core, "sync.flush");
  expect((await probe(core)).conflicts).toBe(1);
  return { mine, theirs };
}

describe("note.edit", () => {
  it("commits once after the autosave debounce", async () => {
    const core = await started();
    await openWelcome(core);
    const before = commitCount();
    expect(
      await ctx.call(core, "note.edit", { path: WELCOME, text: "Edited" }),
    ).toEqual({});
    expect(commitCount()).toBe(before);
    ctx.clock.advance(EDIT_DEBOUNCE_MS + 100);
    await vi.waitFor(() => expect(commitCount()).toBe(before + 1));
    await ctx.call(core, "sync.flush");
    expect(commitCount()).toBe(before + 1);
    expect(await committedWelcome()).toBe("Edited");
  });

  it("validates its params", async () => {
    const core = await started();
    for (const params of [
      { path: "Welcome", text: "x" },
      { path: [1], text: "x" },
      { path: WELCOME, text: 1 },
      { path: WELCOME },
    ]) {
      expect(await ctx.send(core, "note.edit", params)).toMatchObject({
        ok: false,
        error: { kind: "invalidParams" },
      });
    }
  });
});

describe("sync.flush", () => {
  it("answers saved without a running app", async () => {
    expect(await ctx.call(ctx.startCore(), "sync.flush")).toEqual({
      result: { kind: "saved" },
    });
  });

  it("commits at once and answers saved", async () => {
    const core = await started();
    await openWelcome(core);
    const before = commitCount();
    await ctx.call(core, "note.edit", { path: WELCOME, text: "Flushed" });
    expect(await ctx.call(core, "sync.flush")).toEqual({
      result: { kind: "saved" },
    });
    expect(commitCount()).toBe(before + 1);
    expect(await committedWelcome()).toBe("Flushed");
  });

  it("answers unsaved when the forge fails the commit", async () => {
    const core = await started();
    await openWelcome(core);
    ctx.controls.failNext(REPO, "commit", "Network");
    await ctx.call(core, "note.edit", { path: WELCOME, text: "Failing" });
    expect(await ctx.call(core, "sync.flush")).toEqual({
      result: { kind: "unsaved", count: 1 },
    });
  });
});

describe("offline editing", () => {
  it("keeps the edit while offline and saves it on reconnect", async () => {
    const core = await started();
    await openWelcome(core);
    const before = commitCount();
    await ctx.call(core, "lifecycle.setOnline", { online: false });
    await ctx.call(core, "note.edit", { path: WELCOME, text: "Offline" });
    expect(await ctx.call(core, "sync.flush")).toEqual({
      result: { kind: "unsaved", count: 1 },
    });
    expect(commitCount()).toBe(before);
    await ctx.call(core, "lifecycle.setOnline", { online: true });
    await vi.waitFor(() => expect(commitCount()).toBe(before + 1));
    expect(await committedWelcome()).toBe("Offline");
  });
});

describe("auto-refresh with unsaved edits", () => {
  it("never refreshes while a save is failing, then saves", async () => {
    const core = await started();
    await openWelcome(core);
    for (let i = 0; i < 20; i++) {
      ctx.controls.failNext(REPO, "commit", "Network");
    }
    await ctx.call(core, "note.edit", { path: WELCOME, text: "Stuck" });
    const listings = ctx.controls.listTreeCount(REPO);
    for (let i = 0; i < 4; i++) {
      ctx.clock.advance(60_000);
      await Promise.resolve();
    }
    await ctx.call(core, "lifecycle.setVisible", { visible: false });
    await ctx.call(core, "lifecycle.setVisible", { visible: true });
    expect(ctx.controls.listTreeCount(REPO)).toBe(listings);
    expect((await probe(core)).unsaved).toBe(1);

    for (let i = 0; i < 40 && (await probe(core)).unsaved > 0; i++) {
      await ctx.call(core, "sync.retry");
      ctx.clock.advance(60_000);
      await ctx.call(core, "sync.flush");
    }
    expect((await probe(core)).unsaved).toBe(0);
    expect(await committedWelcome()).toBe("Stuck");
  });
});

describe("session.logout", () => {
  it("refuses to log out over unsaved notes unless told to", async () => {
    const core = await started();
    await openWelcome(core);
    const before = commitCount();
    for (let i = 0; i < 20; i++) {
      ctx.controls.failNext(REPO, "commit", "Network");
    }
    await ctx.call(core, "note.edit", { path: WELCOME, text: "Lost" });
    expect(await ctx.call(core, "session.logout", { anyway: false })).toEqual({
      outcome: {
        kind: "unsaved",
        count: 1,
        message: describeLogoutUnsaved(1),
      },
    });
    expect(ctx.events("sessionEnded")).toEqual([]);
    expect(await ctx.call(core, "tree.get")).toHaveProperty("tree");

    expect(await ctx.call(core, "session.logout", { anyway: true })).toEqual({
      outcome: { kind: "loggedOut" },
    });
    expect(ctx.events("sessionEnded")).toEqual([{ reason: "loggedOut" }]);
    expect(await ctx.host.rememberedSession.load()).toBeNull();
    expect(commitCount()).toBe(before);
    expect(await ctx.send(core, "tree.get")).toMatchObject({
      ok: false,
      error: { kind: "notReady" },
    });
  });

  it("logs out directly when everything is saved", async () => {
    const core = await started();
    await openWelcome(core);
    await ctx.call(core, "note.edit", { path: WELCOME, text: "Kept" });
    expect(await ctx.call(core, "session.logout", { anyway: false })).toEqual({
      outcome: { kind: "loggedOut" },
    });
    expect(ctx.events("sessionEnded")).toEqual([{ reason: "loggedOut" }]);
    expect(await committedWelcome()).toBe("Kept");
  });

  it("requires the anyway flag", async () => {
    const core = await started();
    expect(await ctx.send(core, "session.logout", {})).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
  });
});

describe("conflict.resolve", () => {
  it("keeps this device's version", async () => {
    const core = await started();
    const { mine } = await makeConflict(core);
    const before = commitCount();
    await ctx.call(core, "conflict.resolve", {
      path: WELCOME,
      resolution: "keepMine",
    });
    await ctx.call(core, "sync.flush");
    expect((await probe(core)).conflicts).toBe(0);
    expect(commitCount()).toBe(before + 1);
    expect(await committedWelcome()).toBe(mine);
  });

  it("keeps the other device's version without another commit", async () => {
    const core = await started();
    const { theirs } = await makeConflict(core);
    const before = commitCount();
    await ctx.call(core, "conflict.resolve", {
      path: WELCOME,
      resolution: "keepTheirs",
    });
    await ctx.call(core, "sync.flush");
    expect((await probe(core)).conflicts).toBe(0);
    expect(commitCount()).toBe(before);
    expect(await committedWelcome()).toBe(theirs);
  });

  it("commits the merged text once it is edited", async () => {
    const core = await started();
    await makeConflict(core);
    await ctx.call(core, "conflict.resolve", {
      path: WELCOME,
      resolution: "editMerged",
    });
    await ctx.call(core, "note.edit", {
      path: WELCOME,
      text: "Merged by hand",
    });
    await ctx.call(core, "sync.flush");
    expect((await probe(core)).conflicts).toBe(0);
    expect(await committedWelcome()).toBe("Merged by hand");
  });

  it("rejects a bad resolution or path", async () => {
    const core = await started();
    for (const params of [
      { path: WELCOME, resolution: "keepBoth" },
      { path: WELCOME },
      { path: [1], resolution: "keepMine" },
    ]) {
      expect(await ctx.send(core, "conflict.resolve", params)).toMatchObject({
        ok: false,
        error: { kind: "invalidParams" },
      });
    }
  });
});

describe("export.notes", () => {
  it("zips the notes including unsaved edits", async () => {
    const core = await started();
    await openWelcome(core);
    ctx.controls.failNext(REPO, "commit", "Network");
    await ctx.call(core, "note.edit", { path: WELCOME, text: "Unsaved text" });
    const archive = await ctx.call(core, "export.notes", {
      includeImages: false,
    });
    expect(archive.mimeType).toBe("application/zip");
    expect(archive.fileName).toMatch(
      /^commitnote-export-\d{4}-\d{2}-\d{2}\.zip$/,
    );
    const files = unzipSync(
      Uint8Array.from(Buffer.from(archive.base64, "base64")),
    );
    const texts = Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]),
    );
    expect(Object.values(texts)).toContain("Unsaved text");
    expect(Object.keys(texts).length).toBeGreaterThan(2);
  });

  describe("with an inserted image", () => {
    function png(): Uint8Array {
      const out = new Uint8Array(29);
      out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      const view = new DataView(out.buffer);
      view.setUint32(8, 13);
      out.set([0x49, 0x48, 0x44, 0x52], 12);
      view.setUint32(16, 40);
      view.setUint32(20, 30);
      out.set([8, 6, 0, 0, 0], 24);
      return out;
    }

    async function exportWithImage(includeImages: boolean) {
      const core = await started();
      await openWelcome(core);
      const { references } = await ctx.call(core, "image.insert", {
        inputs: [ctx.host.stageInput(png(), "image/png")],
      });
      const id = /image:([a-z2-7]{26})/.exec(references[0]!)![1]!;
      await ctx.call(core, "note.edit", {
        path: WELCOME,
        text: `Intro\n${references[0]}\n`,
      });
      const archive = await ctx.call(core, "export.notes", { includeImages });
      const files = unzipSync(
        Uint8Array.from(Buffer.from(archive.base64, "base64")),
      );
      return { id, files };
    }

    it("stores the image bytes and rewrites the reference when includeImages is true", async () => {
      const { id, files } = await exportWithImage(true);
      const note = Object.entries(files).find(([name]) =>
        name.startsWith("Welcome"),
      )!;
      expect(strFromU8(note[1])).toContain(`_images/${id}.webp`);
      const image = files[`_images/${id}.webp`];
      expect(image).toBeDefined();
      expect(image!.length).toBeGreaterThan(0);
    });

    it("keeps the reference and omits the images when includeImages is false", async () => {
      const { id, files } = await exportWithImage(false);
      const note = Object.entries(files).find(([name]) =>
        name.startsWith("Welcome"),
      )!;
      expect(strFromU8(note[1])).toContain(`image:${id}`);
      expect(Object.keys(files).some((name) => name.includes("_images"))).toBe(
        false,
      );
    });
  });

  it("still works after the key changed on another device", async () => {
    const core = await started();
    await ctx.controls.changeRepoKey(REPO);
    await ctx.send(core, "sync.refresh");
    await vi.waitFor(() => expect(ctx.events("keyChanged")).toHaveLength(1));
    const archive = await ctx.call(core, "export.notes", {
      includeImages: false,
    });
    const files = unzipSync(
      Uint8Array.from(Buffer.from(archive.base64, "base64")),
    );
    expect(Object.keys(files).length).toBeGreaterThan(2);
  });
});
