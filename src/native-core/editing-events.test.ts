import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreEvents, NativeCoreHandle, RemoteTextEdit } from "./api";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const REPO = "sample/notes";
const WELCOME = ["Welcome"];
const IDEAS = ["Projects", "commitnote", "Ideas"];

type SyncPayload = CoreEvents["syncStateChanged"];
type NotePayload = CoreEvents["noteChanged"];
type NoticePayload = CoreEvents["notice"];

let ctx: CoreTestContext;

beforeEach(async () => {
  ctx = await createCoreTestContext({
    extraCommands: (app) => ({
      "test.rename": async (params) => {
        const { path, name } = params as { path: string[]; name: string };
        const result = app.current()!.engine.rename(path, name);
        if (!result.ok) throw new Error("rename failed");
        return {};
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

async function open(core: NativeCoreHandle, path: string[]): Promise<string> {
  const { note } = await ctx.call(core, "note.open", { path });
  return note.content;
}

function lastSync(): SyncPayload {
  return ctx.events("syncStateChanged").at(-1) as SyncPayload;
}

function noteEvents(): NotePayload[] {
  return ctx.events("noteChanged") as NotePayload[];
}

function lastNote(): NotePayload {
  return noteEvents().at(-1)!;
}

function applyEdits(text: string, edits: readonly RemoteTextEdit[]): string {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }
  return result;
}

describe("syncStateChanged", () => {
  it("reports a pending edit with the unsaved menu, then synced", async () => {
    const core = await started();
    await open(core, WELCOME);
    await ctx.call(core, "note.edit", { path: WELCOME, text: "Pending" });
    expect(lastSync()).toMatchObject({
      state: { kind: "out-of-sync", reason: "pending" },
      label: "Out of sync: waiting to save",
      status: "Out of sync: waiting to save",
      unsavedCount: 1,
      canRetry: false,
      unsavedMenu: [{ id: "note-0", label: "Welcome", path: WELCOME }],
    });

    await ctx.call(core, "sync.flush");
    expect(lastSync()).toMatchObject({
      state: { kind: "synced" },
      label: "Synced",
      status: null,
      unsavedCount: 0,
      canRetry: false,
      unsavedMenu: [{ id: "none", label: "No unsaved changes", path: null }],
    });
  });

  it("offers Retry now after a failed save", async () => {
    const core = await started();
    await open(core, WELCOME);
    ctx.controls.failNext(REPO, "commit", "Network");
    await ctx.call(core, "note.edit", { path: WELCOME, text: "Failing" });
    await ctx.call(core, "sync.flush");
    expect(lastSync()).toMatchObject({
      state: { kind: "out-of-sync", reason: "failed" },
      canRetry: true,
      unsavedCount: 1,
    });
    expect(lastSync().unsavedMenu).toEqual([
      { id: "note-0", label: "Welcome", path: WELCOME },
      { id: "retry", label: "Retry now", path: null },
    ]);
  });

  it("reports offline in the status", async () => {
    const core = await started();
    await open(core, WELCOME);
    await ctx.call(core, "lifecycle.setOnline", { online: false });
    await ctx.call(core, "note.edit", { path: WELCOME, text: "Offline" });
    expect(lastSync().online).toBe(false);
    expect(lastSync().status).toMatch(/^Offline/);
    expect(lastSync().canRetry).toBe(false);
  });
});

describe("noteChanged edits", () => {
  it("carries minimal edits for a remote change of the open note", async () => {
    const core = await started();
    const before = await open(core, WELCOME);
    const lines = before.split("\n");
    expect(lines.length).toBeGreaterThan(3);
    const changedLine = 2;
    const after = lines
      .map((line, i) => (i === changedLine ? "Changed elsewhere" : line))
      .join("\n");
    await ctx.controls.editNote(REPO, WELCOME, after);
    await ctx.call(core, "sync.refresh");

    const { note, edits } = lastNote();
    expect(note).toMatchObject({
      state: "loaded",
      path: WELCOME,
      content: after,
    });
    expect(edits).not.toBeNull();
    expect(applyEdits(before, edits!)).toBe(after);
    const lineStart = lines.slice(0, changedLine).join("\n").length + 1;
    const lineEnd = lineStart + lines[changedLine]!.length + 1;
    for (const edit of edits!) {
      expect(edit.from).toBeGreaterThanOrEqual(lineStart);
      expect(edit.to).toBeLessThanOrEqual(lineEnd);
    }
  });

  it.each([
    { name: "an emoji swap sharing the high surrogate", from: "😀", to: "😁", local: true },
    { name: "an emoji inserted before one sharing the high surrogate", from: "😀", to: "😁😀", local: false },
  ])("never splits a surrogate pair for $name", async ({ from, to, local }) => {
    const core = await started();
    const before = await open(core, WELCOME);
    const withEmoji = `${before}\nMood: ${from}\nmore\n`;
    await ctx.controls.editNote(REPO, WELCOME, withEmoji);
    await ctx.call(core, "sync.refresh");
    const base = lastNote().note as { content: string };
    expect(base.content).toBe(withEmoji);

    const after = withEmoji.replace(`Mood: ${from}`, `Mood: ${to}`);
    await ctx.controls.editNote(REPO, WELCOME, after);
    await ctx.call(core, "sync.refresh");

    const { note, edits } = lastNote();
    expect(note).toMatchObject({ state: "loaded", content: after });
    expect(edits).not.toBeNull();
    for (const edit of edits!) {
      expect(edit.insert).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
      for (const position of [edit.from, edit.to]) {
        const splits =
          position > 0 &&
          position < withEmoji.length &&
          withEmoji.charCodeAt(position - 1) >= 0xd800 &&
          withEmoji.charCodeAt(position - 1) <= 0xdbff &&
          withEmoji.charCodeAt(position) >= 0xdc00 &&
          withEmoji.charCodeAt(position) <= 0xdfff;
        expect(splits).toBe(false);
      }
      if (local) expect(edit.to - edit.from).toBeLessThanOrEqual(from.length);
    }
    expect(applyEdits(withEmoji, edits!)).toBe(after);
  });

  it("has no edits when switching notes, even between cached notes", async () => {
    const core = await started();
    await open(core, WELCOME);
    await open(core, IDEAS);
    expect(lastNote()).toMatchObject({
      note: { state: "loaded", path: IDEAS },
      edits: null,
    });

    const count = noteEvents().length;
    await open(core, WELCOME);
    const switched = noteEvents().slice(count);
    expect(switched).toHaveLength(1);
    expect(switched[0]).toMatchObject({
      note: { state: "loaded", path: WELCOME },
      edits: null,
    });
  });

  it("carries edits when the open note is renamed on another device", async () => {
    const core = await started();
    const content = await open(core, WELCOME);

    const other = ctx.startCore();
    await ctx.logIn(other);
    await ctx.call(other, "test.rename", { path: WELCOME, name: "Hello" });
    await ctx.call(other, "sync.flush");
    other.stop();

    const count = noteEvents().length;
    await ctx.call(core, "sync.refresh");
    const renamed = noteEvents()
      .slice(count)
      .find((payload) => payload.note?.path.join("/") === "Hello");
    expect(renamed?.note).toMatchObject({
      state: "loaded",
      path: ["Hello"],
      content,
    });
    expect(renamed?.edits).not.toBeNull();
    expect(applyEdits(content, renamed!.edits!)).toBe(content);
  });
});

describe("conflict on the open note", () => {
  it("describes the conflict, its editing state and the notice action", async () => {
    const core = await started();
    const original = await open(core, WELCOME);
    const lines = original.split("\n");
    const mine = ["Mine first line", ...lines.slice(1)].join("\n");
    const theirs = ["Their first line", ...lines.slice(1)].join("\n");
    await ctx.call(core, "note.edit", { path: WELCOME, text: mine });
    await ctx.controls.editNote(
      REPO,
      WELCOME,
      theirs,
      undefined,
      "Other device",
    );
    await ctx.call(core, "sync.flush");

    const conflict = (lastNote().note as { conflict: unknown }).conflict;
    expect(conflict).toMatchObject({
      otherDevice: "Other device",
      heading: "This note was also changed on Other device",
      keepThisLabel: "Keep this device's version (iPhone)",
      keepOtherLabel: "Keep other device's version (Other device)",
      editMergedLabel: "Edit merged",
      editing: false,
    });
    expect((conflict as { merged: string }).merged).toMatch(/^<<<<<<< /m);
    expect((conflict as { merged: string }).merged).toMatch(/^>>>>>>> /m);

    const notices = ctx.events("notice") as NoticePayload[];
    expect(notices.find((notice) => notice.action !== null)?.action).toEqual({
      kind: "openNote",
      label: "Open note",
      path: WELCOME,
    });

    await ctx.call(core, "conflict.resolve", {
      path: WELCOME,
      resolution: "editMerged",
    });
    await vi.waitFor(() =>
      expect(lastNote().note).toMatchObject({ conflict: { editing: true } }),
    );
  });
});

describe("keyChanged", () => {
  it("labels the export for unsaved notes", async () => {
    const core = await started();
    await open(core, WELCOME);
    await ctx.call(core, "lifecycle.setOnline", { online: false });
    await ctx.call(core, "note.edit", { path: WELCOME, text: "Unsaved" });
    await ctx.controls.changeRepoKey(REPO);
    await ctx.call(core, "lifecycle.setOnline", { online: true });
    await ctx.send(core, "sync.flush");
    await vi.waitFor(() => expect(ctx.events("keyChanged")).toHaveLength(1));
    expect(ctx.events("keyChanged")[0]).toMatchObject({
      unsavedCount: 1,
      exportLabel: "Export unsaved notes",
    });
  });

  it("labels the export for saved notes", async () => {
    const core = await started();
    await ctx.controls.changeRepoKey(REPO);
    await ctx.send(core, "sync.refresh");
    await vi.waitFor(() => expect(ctx.events("keyChanged")).toHaveLength(1));
    expect(ctx.events("keyChanged")[0]).toMatchObject({
      unsavedCount: 0,
      exportLabel: "Export notes",
    });
  });
});
