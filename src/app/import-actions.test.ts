import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import type { AtomicCommitSupport } from "../forge/forge-adapter";
import type { ImportSummary } from "../import/plan-import";
import type { ArchiveImportEntry } from "../import/read-notes-archive";
import {
  createSyncEngine,
  type SyncEngine,
  type SyncEngineState,
} from "../sync/sync-engine";
import { createTestClock } from "../sync/testing/test-clock";
import { findWorkingNode } from "../sync/working-tree";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import {
  describeArchiveError,
  describeFileDropDone,
  describeImportDone,
  describeImportRefusal,
  describeImportUnreachable,
  IMPORT_DESTINATION_GONE_MESSAGE,
  IMPORT_MIXED_FILES_MESSAGE,
} from "../ui/import/import-messages";
import { describeUndoneFileDrop } from "../ui/trash/trash-messages";
import {
  commitImport,
  createArchiveImagePreparer,
  enableAtomicCommits,
  importCompletion,
  importedNotePaths,
  importExpandPath,
  readImportArchive,
  routeImportFiles,
  undoFileDrop,
  type CommitImportDeps,
  type StartedImport,
} from "./import-actions";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

async function setup(atomic?: {
  support: AtomicCommitSupport;
  readonly enableResult: AtomicCommitSupport;
}): Promise<SyncEngine> {
  const fake = await createSampleNotesRepoAdapter();
  const adapter =
    atomic === undefined
      ? fake
      : delegateAdapter(fake, {
          atomicCommitSupport: async () => atomic.support,
          enableAtomicCommits: async () => {
            atomic.support = atomic.enableResult;
            return atomic.support;
          },
        });
  const engine = createSyncEngine({
    adapter,
    keyring,
    clock: createTestClock(1_000_000),
  });
  await engine.refresh();
  return engine;
}

function deps(engine: CommitImportDeps["engine"]): CommitImportDeps {
  return { engine, forgeName: "GitHub" };
}

function exists(engine: SyncEngine, path: NotePath): boolean {
  return findWorkingNode(engine.getState().workingTree!, path) !== undefined;
}

const CLASHING: readonly ArchiveImportEntry[] = [
  { kind: "note", path: ["Welcome"], content: "imported welcome" },
  { kind: "note", path: ["Fresh"], content: "fresh" },
];

describe("routeImportFiles", () => {
  it("routes one zip to the archive import", () => {
    expect(routeImportFiles([{ name: "Notes.ZIP" }])).toEqual({
      kind: "archive",
      index: 0,
    });
  });

  it("refuses a zip mixed with other files", () => {
    expect(routeImportFiles([{ name: "a.zip" }, { name: "b.md" }])).toEqual({
      kind: "error",
      message: IMPORT_MIXED_FILES_MESSAGE,
    });
  });

  it("imports Markdown and text files as dropped notes", () => {
    expect(routeImportFiles([{ name: "a.md" }, { name: "b.txt" }])).toEqual({
      kind: "notes",
    });
  });
});

describe("readImportArchive", () => {
  it("reads a notes archive", () => {
    const result = readImportArchive(zipSync({ "Idea.md": strToU8("body") }));
    expect(result.ok && result.contents.entries).toEqual([
      expect.objectContaining({
        kind: "note",
        path: ["Idea"],
        content: "body",
      }),
    ]);
  });

  it("describes an invalid archive", () => {
    expect(readImportArchive(strToU8("not a zip"))).toEqual({
      ok: false,
      message: describeArchiveError("invalidArchive"),
    });
  });
});

describe("commitImport", () => {
  it("reports conflicts under the stop policy without queuing", async () => {
    const engine = await setup();
    const result = await commitImport(deps(engine), {
      destination: { kind: "root" },
      entries: CLASHING,
      policy: "stop",
    });
    expect(result).toEqual({
      outcome: { kind: "conflicts", count: 1 },
      plan: null,
    });
    expect(engine.getState().importing).toBe(false);
    expect(exists(engine, ["Fresh"])).toBe(false);
  });

  it("renames clashing items under the rename policy", async () => {
    const engine = await setup();
    const result = await commitImport(deps(engine), {
      destination: { kind: "root" },
      entries: CLASHING,
      policy: "rename",
    });
    expect(result.outcome).toEqual({ kind: "queued" });
    expect(result.plan?.summary).toMatchObject({ notes: 2, renamed: 1 });
    expect(importedNotePaths(result.plan!)).toEqual([
      ["Fresh"],
      ["Welcome (2)"],
    ]);
    expect(exists(engine, ["Welcome (2)"])).toBe(true);
    expect(importExpandPath({ kind: "root" }, result.plan!)).toBeNull();
  });

  it("asks for setup when atomic commits need it", async () => {
    const engine = await setup({
      support: { kind: "needsSetup", canConfigure: true },
      enableResult: { kind: "available" },
    });
    const request = {
      destination: { kind: "root" },
      entries: CLASHING,
      policy: "rename",
    } as const;
    expect(await commitImport(deps(engine), request)).toEqual({
      outcome: { kind: "needsSetup", canConfigure: true },
      plan: null,
    });
    expect(
      await enableAtomicCommits({ engine, forgeName: "GitLab" }),
    ).toBeNull();
    expect((await commitImport(deps(engine), request)).outcome).toEqual({
      kind: "queued",
    });
  });

  it("describes a forge that can't be configured or reached", async () => {
    const engine = await setup({
      support: { kind: "needsSetup", canConfigure: true },
      enableResult: { kind: "needsSetup", canConfigure: true },
    });
    expect(await enableAtomicCommits({ engine, forgeName: "GitLab" })).toBe(
      "Couldn't change the GitLab project settings. Try again later.",
    );
    const unreachable = {
      ...engine,
      atomicCommitSupport: () => Promise.reject(new Error("offline")),
    };
    expect(
      (
        await commitImport(deps(unreachable), {
          destination: { kind: "root" },
          entries: CLASHING,
          policy: "rename",
        })
      ).outcome,
    ).toEqual({ kind: "error", message: describeImportUnreachable("GitHub") });
  });

  it("plans again once when the import is outdated", async () => {
    const engine = await setup();
    let calls = 0;
    const flaky: CommitImportDeps["engine"] = {
      atomicCommitSupport: () => engine.atomicCommitSupport(),
      getState: () => engine.getState(),
      addPendingImage: (image) => engine.addPendingImage(image),
      importChanges: (changes) =>
        ++calls === 1
          ? Promise.resolve({ ok: false, reason: "outdated" })
          : engine.importChanges(changes),
    };
    const result = await commitImport(deps(flaky), {
      destination: { kind: "new-folder", parent: [], name: "Imported" },
      entries: [{ kind: "note", path: ["Idea"], content: "idea" }],
      policy: "stop",
    });
    expect(calls).toBe(2);
    expect(result.outcome).toEqual({ kind: "queued" });
    expect(
      importExpandPath(
        { kind: "new-folder", parent: [], name: "Imported" },
        result.plan!,
      ),
    ).toEqual(["Imported"]);
  });

  it("gives up after a second outdated attempt", async () => {
    const engine = await setup();
    const outdated: CommitImportDeps["engine"] = {
      ...engine,
      importChanges: () => Promise.resolve({ ok: false, reason: "outdated" }),
    };
    const result = await commitImport(deps(outdated), {
      destination: { kind: "root" },
      entries: [{ kind: "note", path: ["Idea"], content: "idea" }],
      policy: "stop",
    });
    expect(result.outcome).toEqual({
      kind: "error",
      message: describeImportRefusal("outdated"),
    });
  });

  it("describes a refusal and a missing destination", async () => {
    const engine = await setup();
    const refusing: CommitImportDeps["engine"] = {
      ...engine,
      importChanges: () => Promise.resolve({ ok: false, reason: "unsaved" }),
    };
    const entries = [
      { kind: "note", path: ["Idea"], content: "idea" },
    ] as const;
    expect(
      (
        await commitImport(deps(refusing), {
          destination: { kind: "root" },
          entries,
          policy: "stop",
        })
      ).outcome,
    ).toEqual({ kind: "error", message: describeImportRefusal("unsaved") });
    expect(
      (
        await commitImport(deps(engine), {
          destination: { kind: "folder", path: ["Gone"] },
          entries,
          policy: "stop",
        })
      ).outcome,
    ).toEqual({ kind: "error", message: IMPORT_DESTINATION_GONE_MESSAGE });
  });
});

describe("createArchiveImagePreparer", () => {
  it("prepares an archive once until reset", async () => {
    const preparer = createArchiveImagePreparer({
      keyring,
      process: () => Promise.reject(new Error("unused")),
    });
    const contents = {
      entries: [{ kind: "note", path: ["Idea"], content: "idea" }] as const,
      skipped: {
        unsupported: 0,
        unsafePath: 0,
        reserved: 0,
        invalidName: 0,
        invalidEncoding: 0,
      },
      images: new Map<string, Uint8Array>(),
    };
    const first = await preparer.prepare(contents);
    const again = await preparer.prepare(contents);
    expect(first.ok && again.ok && first.prepared === again.prepared).toBe(
      true,
    );
    preparer.reset();
    const fresh = await preparer.prepare(contents);
    expect(first.ok && fresh.ok && first.prepared !== fresh.prepared).toBe(
      true,
    );
  });
});

describe("importCompletion", () => {
  const summary: ImportSummary = {
    notes: 2,
    folders: 1,
    renamed: 0,
    conflicts: 0,
  };
  const archive: StartedImport = { summary, retryingShown: false };
  const busy: Pick<
    SyncEngineState,
    "importing" | "save" | "stopped" | "atomicBlocked"
  > = {
    importing: true,
    save: { kind: "saving" },
    stopped: null,
    atomicBlocked: null,
  };
  const failedSave = {
    ...busy,
    save: { kind: "waiting", reason: "failed", retryAt: 5, error: null },
  } as const;

  it("does nothing without a started import", () => {
    expect(importCompletion(null, { ...busy, importing: false })).toEqual({
      kind: "none",
    });
  });

  it("clears the import when syncing stopped", () => {
    expect(
      importCompletion(archive, {
        ...busy,
        stopped: { kind: "keyChanged" },
      }),
    ).toEqual({ kind: "cleared" });
  });

  it("reports retrying once while a save waits after a failure", () => {
    expect(importCompletion(archive, failedSave)).toEqual({ kind: "retrying" });
    expect(
      importCompletion({ ...archive, retryingShown: true }, failedSave),
    ).toEqual({ kind: "none" });
    expect(
      importCompletion(archive, {
        ...failedSave,
        atomicBlocked: { canConfigure: true },
      }),
    ).toEqual({ kind: "none" });
    expect(importCompletion(archive, busy)).toEqual({ kind: "none" });
  });

  it("reports an archive import as done", () => {
    const images = { added: 1, failed: 0 };
    expect(
      importCompletion({ ...archive, images }, { ...busy, importing: false }),
    ).toEqual({
      kind: "done",
      tone: "success",
      message: describeImportDone(2, 1, images),
      undoPaths: null,
    });
  });

  it("reports a file drop as done with the paths to undo", () => {
    const skipped = {
      folders: 1,
      unsupported: 0,
      invalidEncoding: 0,
      invalidName: 0,
      tooLarge: 0,
      tooMany: 0,
    };
    const paths = [["A"], ["B"]];
    expect(
      importCompletion(
        { ...archive, fileDrop: { paths, skipped } },
        { ...busy, importing: false },
      ),
    ).toEqual({
      kind: "done",
      tone: "success",
      message: describeFileDropDone(2, skipped),
      undoPaths: paths,
    });
  });
});

describe("undoFileDrop", () => {
  it("trashes dropped notes but keeps shared ones", async () => {
    const engine = await setup();
    const { plan } = await commitImport(deps(engine), {
      destination: { kind: "root" },
      entries: [
        { kind: "note", path: ["Dropped"], content: "a" },
        { kind: "note", path: ["Shared drop"], content: "b" },
      ],
      policy: "rename",
    });
    const paths = importedNotePaths(plan!);
    const result = undoFileDrop(
      { engine },
      paths,
      (path) => (path[0] === "Shared drop" ? 1 : 0),
      ["Dropped"],
    );
    expect(result).toEqual({
      message: describeUndoneFileDrop(1, 1),
      affectsOpenNote: true,
    });
    expect(exists(engine, ["Dropped"])).toBe(false);
    expect(exists(engine, ["Shared drop"])).toBe(true);
  });

  it("reports nothing when the notes are already gone", async () => {
    const engine = await setup();
    expect(
      undoFileDrop(
        { engine },
        [["Missing"]],
        () => 0,
        null,
      ),
    ).toEqual({
      message: null,
      affectsOpenNote: false,
    });
  });
});
