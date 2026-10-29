import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lastViewStorageKey } from "../app/last-view";
import { fromBase64 } from "../crypto/base64";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import type { ForgeRegistry } from "../forge/registry";
import { parseImageReferences } from "../images/image-reference";
import { SAMPLE_IMAGE_WEBP_BASE64 } from "../testing/sample-notes-repo/sample-image";
import { sampleImageNote } from "../testing/sample-notes-repo/sample-source";
import { countTasks, countWords } from "../tree/note-stats";
import { describeNameError } from "../ui/dialogs/name-messages";
import {
  describeTaskProgress,
  describeWordCount,
} from "../ui/history/note-details-messages";
import type { NativeCoreHandle } from "./api";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const WELCOME = ["Welcome"];
const ROADMAP = ["Projects", "commitnote", "Roadmap"];
const IMAGE_NOTE = [...sampleImageNote.folder, sampleImageNote.name];
const REPO_KEY = "github:sample/notes";

let ctx: CoreTestContext;

beforeEach(async () => {
  ctx = await createCoreTestContext();
});

afterEach(() => {
  ctx.dispose();
});

async function started(registry?: ForgeRegistry): Promise<NativeCoreHandle> {
  const core = ctx.startCore(registry);
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

function countingRegistry(): { registry: ForgeRegistry; reads: () => number } {
  let reads = 0;
  const github = ctx.registry.github;
  const registry: ForgeRegistry = {
    ...ctx.registry,
    github: {
      ...github,
      createAdapter: (coordinates, options) =>
        delegateAdapter(github.createAdapter(coordinates, options), {
          listCommits: (request) => {
            reads++;
            return github
              .createAdapter(coordinates, options)
              .listCommits(request);
          },
        }),
    },
  };
  return { registry, reads: () => reads };
}

describe("note.rename", () => {
  it("renames through the title field and reports the outcomes", async () => {
    const core = await started();
    await openNote(core, WELCOME);

    expect(
      await ctx.call(core, "note.rename", { path: WELCOME, name: "Hello" }),
    ).toEqual({ outcome: { kind: "ok", path: ["Hello"] } });

    expect(
      await ctx.call(core, "note.rename", {
        path: ["Hello"],
        name: "Zażółć gęślą jaźń",
      }),
    ).toEqual({
      outcome: {
        kind: "error",
        message: describeNameError({ kind: "duplicate" }),
      },
    });

    expect(
      await ctx.call(core, "note.rename", { path: ["Hello"], name: "   " }),
    ).toEqual({ outcome: { kind: "restore" } });

    expect(
      await ctx.call(core, "note.rename", { path: ["Hello"], name: "Hello" }),
    ).toEqual({ outcome: { kind: "none" } });
  });
});

describe("note.stats", () => {
  it("counts words and tasks of the open note", async () => {
    const core = await started();
    const content = await openNote(core, WELCOME);
    const tasks = countTasks(content);
    expect(tasks.total).toBeGreaterThan(0);

    expect(await ctx.call(core, "note.stats", { path: WELCOME })).toEqual({
      words: describeWordCount(countWords(content)),
      tasks: describeTaskProgress(tasks),
    });
  });

  it("returns no tasks for a note without any and follows edits", async () => {
    const core = await started();
    await openNote(core, ROADMAP);
    await ctx.call(core, "note.edit", { path: ROADMAP, text: "one two three" });

    expect(await ctx.call(core, "note.stats", { path: ROADMAP })).toEqual({
      words: describeWordCount(3),
      tasks: null,
    });
  });

  it("rejects a note that is not the open one", async () => {
    const core = await started();
    await openNote(core, WELCOME);
    const response = await ctx.send(core, "note.stats", { path: ROADMAP });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.kind).toBe("invalidParams");
  });
});

describe("note.dates", () => {
  it("resolves the dates of a saved note and serves repeats from the cache", async () => {
    const counting = countingRegistry();
    const core = await started(counting.registry);
    await openNote(core, WELCOME);

    const first = await ctx.call(core, "note.dates", { path: WELCOME });
    expect(first.notSaved).toBe(false);
    expect(first.created).toMatchObject({ label: expect.any(String) });
    expect(first.updated).toMatchObject({ label: "Updated" });
    const readsAfterFirst = counting.reads();
    expect(readsAfterFirst).toBeGreaterThan(0);

    ctx.clock.advance(2 * 60_000);
    const second = await ctx.call(core, "note.dates", { path: WELCOME });
    expect(counting.reads()).toBe(readsAfterFirst);
    expect(second.created).toEqual(first.created);
    expect(second.updated.label).toBe("Updated");
  });

  it("reports a just-created note as not saved yet", async () => {
    const core = await started();
    await ctx.call(core, "draft.start", { parent: [] });
    const { outcome } = await ctx.call(core, "draft.content", {
      name: "Fresh",
      content: "Something",
    });
    expect(outcome.kind).toBe("created");

    expect(await ctx.call(core, "note.dates", { path: ["Fresh"] })).toEqual({
      notSaved: true,
      created: null,
      updated: null,
    });
  });
});

describe("image.read", () => {
  it("returns the stored image as base64 and null for an unknown id", async () => {
    const core = await started();
    const text = await openNote(core, IMAGE_NOTE);
    const [reference] = parseImageReferences(text);

    const { image } = await ctx.call(core, "image.read", {
      imageId: reference!.imageId,
    });
    expect(image.type).toBe("image/webp");
    expect(fromBase64(image.base64)).toEqual(
      fromBase64(SAMPLE_IMAGE_WEBP_BASE64),
    );

    const unknown = "a".repeat(reference!.imageId.length);
    expect(unknown).not.toBe(reference!.imageId);
    expect(await ctx.call(core, "image.read", { imageId: unknown })).toEqual({
      image: null,
    });
  });
});

describe("lastView", () => {
  async function waitForStoredFolders(count: number): Promise<void> {
    const key = lastViewStorageKey(REPO_KEY);
    await expect
      .poll(() => {
        const raw = ctx.host.deviceSettings.getItem(key);
        return raw === null
          ? -1
          : (JSON.parse(raw) as { folders: string[] }).folders.length;
      })
      .toBe(count);
  }

  it("round-trips across a restart and drops folders that no longer exist", async () => {
    const first = await started();
    expect(await ctx.call(first, "lastView.load")).toEqual({
      view: { note: null, folders: [] },
    });
    await ctx.call(first, "lastView.save", {
      note: WELCOME,
      folders: [["Projects"], ["Projects", "commitnote"], ["Gone", "Away"]],
    });
    ctx.clock.advance(1_000);
    await waitForStoredFolders(3);
    first.stop();

    const second = await started();
    expect(await ctx.call(second, "lastView.load")).toEqual({
      view: {
        note: WELCOME,
        folders: [["Projects"], ["Projects", "commitnote"]],
      },
    });
  });

  it("drops a note that no longer exists", async () => {
    const first = await started();
    await ctx.call(first, "lastView.load");
    await ctx.call(first, "lastView.save", { note: ["Gone"], folders: [] });
    ctx.clock.advance(1_000);
    await expect
      .poll(() => ctx.host.deviceSettings.getItem(lastViewStorageKey(REPO_KEY)))
      .toContain('"note":"');
    first.stop();

    const second = await started();
    expect(await ctx.call(second, "lastView.load")).toEqual({
      view: { note: null, folders: [] },
    });
  });

  it("is removed when logging out", async () => {
    const core = await started();
    await ctx.call(core, "lastView.load");
    await ctx.call(core, "lastView.save", { note: WELCOME, folders: [] });
    ctx.clock.advance(1_000);
    await waitForStoredFolders(0);
    expect(
      ctx.host.deviceSettings.getItem(lastViewStorageKey(REPO_KEY)),
    ).not.toBeNull();

    await ctx.call(core, "session.logout", { anyway: true });
    expect(
      ctx.host.deviceSettings.getItem(lastViewStorageKey(REPO_KEY)),
    ).toBeNull();
  });
});

describe("earlyDraft.handOff", () => {
  it("does nothing for an untouched early draft", async () => {
    const core = await started();
    expect(
      await ctx.call(core, "earlyDraft.handOff", {
        name: "",
        body: "",
        nameConfirmed: false,
      }),
    ).toEqual({ outcome: { kind: "none" } });
  });

  it("creates a note under the automatic name from a body alone", async () => {
    const core = await started();
    const { outcome } = await ctx.call(core, "earlyDraft.handOff", {
      name: "",
      body: "Quick thought",
      nameConfirmed: false,
    });
    expect(outcome.kind).toBe("created");
    expect(outcome.path).toHaveLength(1);
    expect(outcome.path[0]).not.toBe("");
    expect(await openNote(core, outcome.path)).toBe("Quick thought");
  });

  it("creates a note with the confirmed name and body", async () => {
    const core = await started();
    const { outcome } = await ctx.call(core, "earlyDraft.handOff", {
      name: "Plans",
      body: "Body text",
      nameConfirmed: true,
    });
    expect(outcome).toEqual({
      kind: "created",
      path: ["Plans"],
      fieldError: null,
    });
    expect(await openNote(core, ["Plans"])).toBe("Body text");
  });

  it("leaves a draft with the error for a duplicate name", async () => {
    const core = await started();
    const { outcome } = await ctx.call(core, "earlyDraft.handOff", {
      name: "Welcome",
      body: "",
      nameConfirmed: true,
    });
    expect(outcome).toEqual({
      kind: "draft",
      name: "Welcome",
      error: describeNameError({ kind: "duplicate" }),
    });

    const retry = await ctx.call(core, "draft.commitName", {
      name: "Welcome again",
    });
    expect(retry.outcome.kind).toBe("created");
  });

  it("keeps an unconfirmed name as a draft", async () => {
    const core = await started();
    expect(
      await ctx.call(core, "earlyDraft.handOff", {
        name: "Half",
        body: "",
        nameConfirmed: false,
      }),
    ).toEqual({ outcome: { kind: "draft", name: "Half", error: null } });
  });
});
