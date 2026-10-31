import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotePath } from "../changes/change";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import type { AtomicCommitSupport } from "../forge/forge-adapter";
import type { ForgeRegistry } from "../forge/registry";
import { parseImageReferences } from "../images/image-reference";
import { findWorkingNode } from "../sync/working-tree";
import {
  describeArchiveError,
  describeAtomicSetup,
  describeFileDropDone,
  describeImportConflicts,
  describeImportDone,
  describeNothingDropped,
  ENABLE_ATOMIC_LABEL,
  IMPORT_MIXED_FILES_MESSAGE,
  IMPORT_ROOT_FOLDER_LABEL,
} from "../ui/import/import-messages";
import { describeUndoneFileDrop } from "../ui/trash/trash-messages";
import type { CoreEvents, ImportForm, NativeCoreHandle } from "./api";
import type { AppSession, NativeRunningApp } from "./app-session";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const NO_DROP_SKIPS = {
  folders: 0,
  unsupported: 0,
  invalidEncoding: 0,
  invalidName: 0,
  tooLarge: 0,
  tooMany: 0,
};

let ctx: CoreTestContext;
let app: AppSession;

afterEach(() => {
  ctx.dispose();
});

async function started(
  registry?: (base: ForgeRegistry) => ForgeRegistry,
): Promise<NativeCoreHandle> {
  ctx = await createCoreTestContext();
  const core = ctx.startCore(registry?.(ctx.registry), (session) => {
    app = session;
    return {};
  });
  await ctx.logIn(core);
  return core;
}

function current(): NativeRunningApp {
  const running = app.current();
  if (running === null) throw new Error("expected a running app");
  return running;
}

function exists(path: NotePath): boolean {
  const tree = current().engine.getState().workingTree!;
  return findWorkingNode(tree, path) !== undefined;
}

function png(width: number, height: number): Uint8Array {
  const out = new Uint8Array(8 + 8 + 13);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set(strToU8("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  out.set([8, 6, 0, 0, 0], 24);
  return out;
}

function notices(): CoreEvents["notice"][] {
  return ctx.events("notice") as CoreEvents["notice"][];
}

async function waitForNotice(
  message: string | RegExp,
): Promise<CoreEvents["notice"]> {
  return vi.waitFor(
    () => {
      const found = notices().find((notice) =>
        typeof message === "string"
          ? notice.message === message
          : message.test(notice.message),
      );
      if (found === undefined) throw new Error("No notice yet");
      return found;
    },
    { timeout: 5_000, interval: 2 },
  );
}

async function readArchive(
  core: NativeCoreHandle,
  bytes: Uint8Array,
  fileName = "Archive.zip",
) {
  const input = ctx.host.stageInput(bytes, "application/zip");
  return ctx.call(core, "import.readArchive", { input, fileName });
}

async function flush(core: NativeCoreHandle): Promise<void> {
  expect(await ctx.call(core, "sync.flush")).toEqual({
    result: { kind: "saved" },
  });
}

function stageText(text: string): string {
  return ctx.host.stageInput(strToU8(text), "text/markdown");
}

async function drop(
  core: NativeCoreHandle,
  files: { name: string; input: string }[],
  parent: string[] | null = null,
  source: "picker" | "tree" = "picker",
) {
  return (await ctx.call(core, "import.dropFiles", { files, parent, source }))
    .outcome;
}

describe("archive import", () => {
  it("imports notes and an archive image into a new folder", async () => {
    const core = await started();
    const opened = await readArchive(
      core,
      zipSync({
        "One.md": strToU8("![](_images/pic.png)\n"),
        "Two.md": strToU8("two"),
        "_images/pic.png": png(4, 3),
      }),
    );
    expect(opened.kind).toBe("ready");
    const form = opened.form as ImportForm;
    expect(form).toMatchObject({
      fileName: "Archive.zip",
      defaultFolderName: "Archive",
      skipped: null,
      empty: false,
    });
    expect(form.targets[0]).toEqual({
      path: [],
      label: IMPORT_ROOT_FOLDER_LABEL,
      depth: 0,
    });
    expect(form.targets).toContainEqual({
      path: ["Projects", "commitnote"],
      label: "commitnote",
      depth: 2,
    });

    const destination = { kind: "newFolder", parent: [], name: "Archive" };
    expect(await ctx.call(core, "import.preview", { destination })).toEqual({
      text: "Imports 2 notes and 1 folder.",
    });
    expect(
      await ctx.call(core, "import.preview", {
        destination: { ...destination, name: "a/b" },
      }),
    ).toEqual({ text: null });

    const { outcome } = await ctx.call(core, "import.commit", {
      destination,
      policy: "stop",
    });
    expect(outcome).toEqual({ kind: "queued", expand: ["Archive"] });
    await flush(core);

    const message = describeImportDone(2, 1, { added: 1, failed: 0 });
    expect((await waitForNotice(message)).tone).toBe("success");
    const state = current().engine.getState();
    expect(exists(["Archive", "One"])).toBe(true);
    expect(exists(["Archive", "Two"])).toBe(true);
    const opened2 = await ctx.call(core, "note.open", {
      path: ["Archive", "One"],
    });
    const [reference] = parseImageReferences(opened2.note.content as string);
    expect(reference).toBeDefined();
    expect(state.synced!.images.images.has(reference!.imageId)).toBe(true);
    expect(
      current().engine.getPendingImage(reference!.imageId),
    ).toBeUndefined();

    const statuses = ctx.events(
      "importStatusChanged",
    ) as CoreEvents["importStatusChanged"][];
    expect(statuses.some((status) => status.importing)).toBe(true);
    expect(statuses[statuses.length - 1]).toEqual({
      importing: false,
      atomicBlocked: null,
    });
    const settings = (
      ctx.events("settingsChanged") as CoreEvents["settingsChanged"][]
    ).map(({ view }) => view.canImport);
    expect(settings).toContain(false);
    expect(settings[settings.length - 1]).toBe(true);
  });

  it("reports name conflicts and renames on request", async () => {
    const core = await started();
    await readArchive(core, zipSync({ "Ideas.md": strToU8("new ideas") }));
    const destination = { kind: "folder", path: ["Projects", "commitnote"] };

    const stopped = await ctx.call(core, "import.commit", {
      destination,
      policy: "stop",
    });
    expect(stopped.outcome).toEqual({
      kind: "conflicts",
      count: 1,
      message: describeImportConflicts(1),
    });

    const renamed = await ctx.call(core, "import.commit", {
      destination,
      policy: "rename",
    });
    expect(renamed.outcome).toEqual({
      kind: "queued",
      expand: ["Projects", "commitnote"],
    });
    await flush(core);
    expect(exists(["Projects", "commitnote", "Ideas (2)"])).toBe(true);
  });

  it("returns the archive error and flags an empty archive", async () => {
    const core = await started();
    expect(await readArchive(core, strToU8("not a zip"))).toEqual({
      kind: "error",
      message: describeArchiveError("invalidArchive"),
    });
    const empty = await readArchive(core, zipSync({}));
    expect(empty.kind).toBe("ready");
    expect(empty.form.empty).toBe(true);
  });

  it("rejects an input that was never staged", async () => {
    const core = await started();
    const response = await ctx.send(core, "import.readArchive", {
      input: "missing",
      fileName: "Archive.zip",
    });
    expect(response).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
  });

  it("clears the tag filter once the import is queued", async () => {
    const core = await started();
    await ctx.call(core, "tags.setFilter", { tag: "green" });
    const trees = () =>
      ctx.events("treeChanged") as CoreEvents["treeChanged"][];
    expect(trees()[trees().length - 1]!.tagFilter).toBe("green");

    await readArchive(core, zipSync({ "Fresh.md": strToU8("fresh") }));
    await ctx.call(core, "import.commit", {
      destination: { kind: "root" },
      policy: "stop",
    });
    expect(trees()[trees().length - 1]!.tagFilter).toBeNull();
  });
});

describe("atomic commit setup", () => {
  function needingSetup(base: ForgeRegistry): ForgeRegistry {
    let support: AtomicCommitSupport = {
      kind: "needsSetup",
      canConfigure: true,
    };
    const github = base.github;
    return {
      ...base,
      github: {
        ...github,
        createAdapter: (coordinates, options) =>
          delegateAdapter(github.createAdapter(coordinates, options), {
            atomicCommitSupport: async () => support,
            enableAtomicCommits: async () => {
              support = { kind: "available" };
              return support;
            },
          }),
      },
    };
  }

  it("asks for setup, enables atomic commits, then imports", async () => {
    const core = await started(needingSetup);
    await readArchive(core, zipSync({ "Fresh.md": strToU8("fresh") }));
    const destination = { kind: "root" };
    const first = await ctx.call(core, "import.commit", {
      destination,
      policy: "stop",
    });
    expect(first.outcome).toEqual({
      kind: "needsSetup",
      canConfigure: true,
      message: describeAtomicSetup("GitHub", true),
      actionLabel: ENABLE_ATOMIC_LABEL,
    });
    expect(await ctx.call(core, "import.enableAtomic")).toEqual({
      error: null,
      outcome: null,
    });
    const second = await ctx.call(core, "import.commit", {
      destination,
      policy: "stop",
    });
    expect(second.outcome).toEqual({ kind: "queued", expand: null });
    await flush(core);
    expect(exists(["Fresh"])).toBe(true);
  });

  it("retries held dropped files after enabling atomic commits", async () => {
    const core = await started(needingSetup);
    const outcome = await drop(core, [
      { name: "Dropped.md", input: stageText("dropped") },
    ]);
    expect(outcome.kind).toBe("needsSetup");
    const enabled = await ctx.call(core, "import.enableAtomic");
    expect(enabled).toEqual({
      error: null,
      outcome: { kind: "queued", expand: null },
    });
    await flush(core);
    expect(exists(["Dropped"])).toBe(true);
  });
});

describe("file drops", () => {
  it("imports dropped notes at the root and into a folder with renames", async () => {
    const core = await started();
    expect(
      await drop(core, [{ name: "Dropped.md", input: stageText("dropped") }]),
    ).toEqual({ kind: "queued", expand: null });
    await flush(core);
    await waitForNotice(describeFileDropDone(1, NO_DROP_SKIPS));
    expect(exists(["Dropped"])).toBe(true);

    expect(
      await drop(
        core,
        [{ name: "January.md", input: stageText("again") }],
        ["Journal", "2026"],
      ),
    ).toEqual({ kind: "queued", expand: ["Journal", "2026"] });
    await flush(core);
    expect(exists(["Journal", "2026", "January (2)"])).toBe(true);
  });

  it("refuses a zip mixed into a picker drop but skips it from the tree", async () => {
    const core = await started();
    const files = () => [
      { name: "Notes.zip", input: ctx.host.stageInput(zipSync({}), "") },
      { name: "Loose.md", input: stageText("loose") },
    ];
    expect(await drop(core, files())).toEqual({
      kind: "error",
      message: IMPORT_MIXED_FILES_MESSAGE,
    });
    expect(exists(["Loose"])).toBe(false);

    expect((await drop(core, files(), null, "tree")).kind).toBe("queued");
    await flush(core);
    await waitForNotice(
      describeFileDropDone(1, { ...NO_DROP_SKIPS, unsupported: 1 }),
    );
    expect(exists(["Loose"])).toBe(true);
  });

  it("undoes a drop, keeping a shared note", async () => {
    const core = await started();
    await drop(core, [
      { name: "Gone.md", input: stageText("gone") },
      { name: "Kept.md", input: stageText("kept") },
    ]);
    await flush(core);
    const done = await waitForNotice(describeFileDropDone(2, NO_DROP_SKIPS));
    expect(done.action).toEqual({ kind: "undo", label: "Undo" });
    await ctx.call(core, "share.create", {
      path: ["Kept"],
      password: "",
      label: "",
    });

    await ctx.call(core, "notices.perform", { id: done.id });
    await waitForNotice(describeUndoneFileDrop(1, 1));
    expect(exists(["Gone"])).toBe(false);
    expect(exists(["Kept"])).toBe(true);
  });

  it("reports a drop with nothing importable", async () => {
    const core = await started();
    expect(
      await drop(core, [
        { name: "pic.png", input: ctx.host.stageInput(png(2, 2), "image/png") },
      ]),
    ).toEqual({
      kind: "error",
      message: describeNothingDropped({ ...NO_DROP_SKIPS, unsupported: 1 }),
    });
  });
});
