import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageFilePath } from "../images/image-id";
import { parseImageReferences } from "../images/image-reference";
import { describeSyncError } from "../ui/browse/sync-messages";
import { describeNameError } from "../ui/dialogs/name-messages";
import {
  describeRestoreBlock,
  RESTORE_LABEL,
  SAME_AS_CURRENT_MESSAGE,
  SAVE_FIRST_MESSAGE,
  SAVING_CHANGES_MESSAGE,
} from "../ui/history/history-messages";
import type {
  CoreEvents,
  HistoryVersionView,
  HistoryView,
  NativeCoreHandle,
} from "./api";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const REPO = "sample/notes";
const WELCOME = ["Welcome"];

interface ImageProbe {
  blobSha: string;
  owners: readonly unknown[];
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
        return { ok: result.ok };
      },
      "test.failNextRead": async (): Promise<{}> => {
        vi.spyOn(
          app.current()!.services.noteHistory,
          "readVersion",
        ).mockResolvedValueOnce({
          kind: "failed",
          error: { kind: "network" },
        });
        return {};
      },
      "test.image": async (params): Promise<ImageProbe | null> => {
        const { id } = params as { id: string };
        const index = app.current()!.engine.getState().synced!.images;
        return (
          (index.images.get(id as never) as ImageProbe | undefined) ?? null
        );
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

async function openNote(
  core: NativeCoreHandle,
  path: string[],
): Promise<string> {
  const { note } = await ctx.call(core, "note.open", { path });
  expect(note.state).toBe("loaded");
  return note.content as string;
}

async function save(
  core: NativeCoreHandle,
  path: string[],
  text: string,
): Promise<void> {
  await ctx.call(core, "note.edit", { path, text });
  expect(await ctx.call(core, "sync.flush")).toEqual({
    result: { kind: "saved" },
  });
}

async function currentContent(
  core: NativeCoreHandle,
  path: string[],
): Promise<string | undefined> {
  const { note } = await ctx.call(core, "note.open", { path });
  return note?.state === "loaded" ? note.content : undefined;
}

function histories(): (HistoryView | null)[] {
  return (ctx.events("historyChanged") as CoreEvents["historyChanged"][]).map(
    (event) => event.history,
  );
}

function lastHistory(): HistoryView | null {
  const all = histories();
  return all[all.length - 1] ?? null;
}

async function readyHistory(): Promise<HistoryView> {
  return vi.waitFor(() => {
    const view = lastHistory();
    if (view?.phase !== "ready" || view.loading) throw new Error("Not ready");
    return view;
  });
}

function versionsOf(view: HistoryView): HistoryVersionView[] {
  return view.sections.flatMap((section) =>
    section.rows.flatMap((row) =>
      row.kind === "single" ? [row.version] : row.versions,
    ),
  );
}

function notices(): CoreEvents["notice"][] {
  return ctx.events("notice") as CoreEvents["notice"][];
}

function clearedIds(): string[] {
  return (ctx.events("noticeCleared") as { id: string }[]).map(({ id }) => id);
}

/** Saves an edit of Welcome and opens its history; returns the texts and the versions. */
async function editedWelcome(core: NativeCoreHandle) {
  const original = await openNote(core, WELCOME);
  const edited = original.replace(/^.*$/m, "A different first line");
  await save(core, WELCOME, edited);
  await ctx.call(core, "history.open", { path: WELCOME });
  const versions = versionsOf(await readyHistory());
  return { original, edited, newest: versions[0]!, older: versions[1]! };
}

async function preview(
  core: NativeCoreHandle,
  sha: string,
  restoreTitle = false,
) {
  return (await ctx.call(core, "history.preview", { sha, restoreTitle }))
    .preview;
}

async function restore(
  core: NativeCoreHandle,
  sha: string,
  restoreTitle = false,
) {
  return (await ctx.call(core, "history.restore", { sha, restoreTitle }))
    .outcome;
}

describe("history.open", () => {
  it("shows saving, then the versions with the newest as current", async () => {
    const core = await started();
    const { newest } = await editedWelcome(core);

    const [saving] = histories();
    expect(saving).toMatchObject({
      path: WELCOME,
      phase: "saving",
      message: SAVING_CHANGES_MESSAGE,
      sections: [],
      canLoadMore: false,
    });
    const view = lastHistory()!;
    expect(view.message).toBeNull();
    expect(versionsOf(view).length).toBeGreaterThanOrEqual(2);
    expect(view.sections[0]!.rows[0]).toEqual({
      kind: "single",
      version: expect.objectContaining({ current: true, shared: false }),
    });
    expect(versionsOf(view).filter((v) => v.current)).toEqual([newest]);
    expect(view.canLoadMore).toBe(view.end === null);
  });

  it("asks to save first when the note has never been saved", async () => {
    const core = await started();
    await ctx.call(core, "lifecycle.setOnline", { online: false });
    await ctx.call(core, "draft.start", { parent: [] });
    await ctx.call(core, "draft.commitName", { name: "Plans" });

    await ctx.call(core, "history.open", { path: ["Plans"] });

    expect(histories().map((view) => view?.phase)).toEqual([
      "saving",
      "unsaved",
    ]);
    expect(lastHistory()).toMatchObject({
      phase: "unsaved",
      message: SAVE_FIRST_MESSAGE,
      sections: [],
    });
  });

  it("rejects a path that is not the open note", async () => {
    const core = await started();
    await openNote(core, WELCOME);
    const response = await ctx.send(core, "history.open", {
      path: ["Projects"],
    });
    expect(response).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
  });

  it("closes when another note is opened", async () => {
    const core = await started();
    await editedWelcome(core);

    await ctx.call(core, "note.open", { path: ["Projects", "commitnote"] });

    expect(lastHistory()).toBeNull();
    const response = await ctx.send(core, "history.preview", {
      sha: "unknown",
      restoreTitle: false,
    });
    expect(response).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
  });

  it("flags a shared version", async () => {
    const core = await started();
    const { newest } = await editedWelcome(core);
    expect(newest.shared).toBe(false);

    expect(await ctx.call(core, "test.share", { path: WELCOME })).toEqual({
      ok: true,
    });

    await vi.waitFor(() =>
      expect(versionsOf(lastHistory()!)[0]!.shared).toBe(true),
    );
  });
});

describe("history.preview", () => {
  it("shows what restoring an older version would change", async () => {
    const core = await started();
    const { older } = await editedWelcome(core);

    const result = await preview(core, older.sha);

    expect(result).toMatchObject({
      kind: "version",
      titleChange: null,
      restoreTitle: null,
      restore: { label: RESTORE_LABEL, enabled: true, reason: null },
    });
    expect(result.body.kind).toBe("diff");
    const kinds = result.body.items
      .filter((item: { kind: string }) => item.kind === "line")
      .map((item: { line: { kind: string } }) => item.line.kind);
    expect(kinds).toContain("removed");
    expect(kinds).toContain("added");
  });

  it("says the current version is the same as the note", async () => {
    const core = await started();
    const { newest } = await editedWelcome(core);

    expect(await preview(core, newest.sha)).toMatchObject({
      kind: "version",
      body: { kind: "unchanged", message: SAME_AS_CURRENT_MESSAGE },
      restore: {
        enabled: false,
        reason: describeRestoreBlock("same"),
      },
    });
  });

  it("rejects an unknown version", async () => {
    const core = await started();
    await editedWelcome(core);
    const response = await ctx.send(core, "history.preview", {
      sha: "0".repeat(40),
      restoreTitle: false,
    });
    expect(response).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
  });

  it("does not keep a failed read", async () => {
    const core = await started();
    const { older } = await editedWelcome(core);
    await ctx.call(core, "test.failNextRead");

    expect(await preview(core, older.sha)).toEqual({
      kind: "failed",
      message: describeSyncError({ kind: "network" }, ctx.registry.github.name),
    });
    expect((await preview(core, older.sha)).kind).toBe("version");
  });
});

describe("history.restore", () => {
  it("restores the content and offers Undo", async () => {
    const core = await started();
    const { original, edited, older } = await editedWelcome(core);

    expect(await restore(core, older.sha)).toEqual({ kind: "restored" });

    expect(await currentContent(core, WELCOME)).toBe(original);
    expect(lastHistory()).toBeNull();
    const notice = notices().at(-1)!;
    expect(notice).toMatchObject({
      tone: "success",
      action: { kind: "undo", label: "Undo" },
    });
    expect(notice.message).toMatch(/^Restored the version from /);

    await ctx.call(core, "notices.perform", { id: notice.id });
    expect(await currentContent(core, WELCOME)).toBe(edited);
  });

  it("restores the title too when asked", async () => {
    const core = await started();
    await openNote(core, WELCOME);
    expect(
      await ctx.call(core, "note.rename", { path: WELCOME, name: "Hello" }),
    ).toEqual({ outcome: { kind: "ok", path: ["Hello"] } });
    await ctx.call(core, "sync.flush");
    await ctx.call(core, "history.open", { path: ["Hello"] });
    const versions = versionsOf(await readyHistory());
    const older = versions.find((version) => version.name === "Welcome")!;

    const result = await preview(core, older.sha, true);
    expect(result).toMatchObject({
      kind: "version",
      titleChange: "Title: “Hello” → “Welcome”",
      restoreTitle: "Also restore the title “Welcome”",
      restore: { enabled: true },
    });

    expect(await restore(core, older.sha, true)).toEqual({ kind: "restored" });
    expect(await currentContent(core, WELCOME)).toBeDefined();
  });

  it("reports a duplicate title and leaves the content alone", async () => {
    const core = await started();
    const before = await openNote(core, WELCOME);
    await save(core, WELCOME, `${before}\nMore\n`);
    await ctx.call(core, "note.rename", { path: WELCOME, name: "Hello" });
    await ctx.call(core, "sync.flush");
    await ctx.call(core, "draft.start", { parent: [] });
    await ctx.call(core, "draft.commitName", { name: "Welcome" });
    await ctx.call(core, "sync.flush");
    const current = await openNote(core, ["Hello"]);
    await ctx.call(core, "history.open", { path: ["Hello"] });
    const older = versionsOf(await readyHistory()).find(
      (version) => version.name === "Welcome",
    )!;

    expect(await restore(core, older.sha, true)).toEqual({
      kind: "error",
      message: describeNameError({ kind: "duplicate" }),
    });
    expect(await currentContent(core, ["Hello"])).toBe(current);
  });

  it("clears the Undo notice once the note is typed in", async () => {
    const core = await started();
    const { original, older } = await editedWelcome(core);
    await restore(core, older.sha);
    const notice = notices().at(-1)!;
    expect(clearedIds()).not.toContain(notice.id);

    await ctx.call(core, "note.edit", {
      path: WELCOME,
      text: `${original}typed`,
    });

    expect(clearedIds()).toContain(notice.id);
    await ctx.call(core, "notices.perform", { id: notice.id });
    expect(await currentContent(core, WELCOME)).toBe(`${original}typed`);
  });

  it("is blocked while the note has a conflict", async () => {
    const core = await started();
    const { edited, older } = await editedWelcome(core);
    const rest = edited.split("\n").slice(1);
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

    expect(await restore(core, older.sha)).toEqual({
      kind: "blocked",
      message: describeRestoreBlock("conflicted"),
    });
  });

  it("reports a failed read with the sync error", async () => {
    const core = await started();
    const { edited, older } = await editedWelcome(core);
    await ctx.call(core, "test.failNextRead");

    expect(await restore(core, older.sha)).toEqual({
      kind: "error",
      message: describeSyncError({ kind: "network" }, ctx.registry.github.name),
    });
    expect(await currentContent(core, WELCOME)).toBe(edited);
  });

  it("brings back an image deleted since the version was saved", async () => {
    const core = await started();
    const text = await openNote(core, WELCOME);
    const { references } = await ctx.call(core, "image.insert", {
      inputs: [ctx.host.stageInput(png(40, 30), "image/png")],
    });
    const withImage = `${text}\n${references[0]}\n`;
    const id = parseImageReferences(withImage)[0]!.imageId;
    await save(core, WELCOME, withImage);
    const { blobSha } = (await ctx.call(core, "test.image", { id }))!;
    await save(core, WELCOME, text);
    expect(await ctx.call(core, "test.image", { id })).toBeNull();

    await ctx.call(core, "history.open", { path: WELCOME });
    const older = versionsOf(await readyHistory())[1]!;
    expect(await restore(core, older.sha)).toEqual({ kind: "restored" });
    expect(await ctx.call(core, "sync.flush")).toEqual({
      result: { kind: "saved" },
    });

    expect(await ctx.controls.headPaths(REPO)).toContain(imageFilePath(id));
    expect(await ctx.call(core, "test.image", { id })).toEqual({
      blobSha,
      owners: [{ state: "active", path: WELCOME }],
    });
  });
});

function png(width: number, height: number): Uint8Array {
  const out = new Uint8Array(8 + 8 + 13);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set(
    Array.from("IHDR", (char) => char.charCodeAt(0)),
    12,
  );
  view.setUint32(16, width);
  view.setUint32(20, height);
  out.set([8, 6, 0, 0, 0], 24);
  return out;
}
