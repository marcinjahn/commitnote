import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import type { ShareEntry } from "../share/share-index";
import type { RevokeSharesResult } from "../share/share-service";
import { createSyncEngine, type SyncEngine } from "../sync/sync-engine";
import {
  WELCOME,
  heldWelcomeConflict,
} from "../sync/testing/engine-harness";
import { createTestClock } from "../sync/testing/test-clock";
import { findWorkingNode, type WorkingFolder } from "../sync/working-tree";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import {
  describeMovedDown,
  describeMovedTo,
  describeStructureError,
} from "../ui/browse/structure-messages";
import { describeNameError } from "../ui/dialogs/name-messages";
import { describeShareError, messageText } from "../ui/share/share-messages";
import {
  describeRevokeFailed,
  describeMovedToTrash,
} from "../ui/trash/trash-messages";
import {
  commitNoteName,
  emptyTrash,
  moveAmongSiblings,
  placeNode,
  renameNode,
  restoreFromTrash,
  trashNode,
  trashPreview,
  undoPlace,
  undoTrash,
  type TrashNodeDeps,
} from "./structure-actions";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

const EMPTY_FOLDER: NotePath = ["Empty folder"];
const PROJECTS: NotePath = ["Projects"];

const SHARE: ShareEntry = {
  id: "share-1",
  locator: { provider: "gitlab", snippetId: "42" },
  linkSecret: "secret",
  password: null,
  name: "Welcome",
  label: null,
  sharedAt: "2026-01-01T00:00:00.000Z",
  note: { state: "active", path: WELCOME },
  source: null,
  updatedAt: null,
};

async function setup() {
  const fake = await createSampleNotesRepoAdapter();
  const engine = createSyncEngine({
    adapter: fake,
    keyring,
    clock: createTestClock(1_000_000),
  });
  await engine.refresh();
  return { fake, engine };
}

function childNames(engine: SyncEngine, parent: NotePath): string[] {
  const tree = engine.getState().workingTree!;
  const folder =
    parent.length === 0 ? tree.root : (findWorkingNode(tree, parent) as WorkingFolder);
  return folder.children.map((child) => child.name);
}

function exists(engine: SyncEngine, path: NotePath): boolean {
  return findWorkingNode(engine.getState().workingTree!, path) !== undefined;
}

function trashDeps(
  engine: SyncEngine,
  revokeShares: TrashNodeDeps["revokeShares"] = async () => ({
    ok: true,
    revoked: 0,
  }),
): TrashNodeDeps {
  return { engine, revokeShares, forgeId: "github" };
}

describe("renameNode", () => {
  it("renames an item", async () => {
    const { engine } = await setup();
    expect(renameNode(engine, WELCOME, "Hello")).toEqual({
      kind: "ok",
      path: ["Hello"],
    });
    expect(exists(engine, ["Hello"])).toBe(true);
  });

  it("describes a duplicate name", async () => {
    const { engine } = await setup();
    const outcome = renameNode(engine, WELCOME, "Projects");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toBe(
        describeNameError({ kind: "duplicate" }),
      );
    }
    expect(exists(engine, WELCOME)).toBe(true);
  });
});

describe("commitNoteName", () => {
  const input = { path: WELCOME, conflicted: false, currentName: "Welcome" };

  it("renames on a new name and ignores an unchanged one", async () => {
    const { engine } = await setup();
    expect(commitNoteName(engine, { ...input, value: "Welcome" })).toEqual({
      kind: "none",
    });
    expect(commitNoteName(engine, { ...input, value: "Hello" })).toEqual({
      kind: "ok",
      path: ["Hello"],
    });
  });

  it("restores a blank name and reports a taken one", async () => {
    const { engine } = await setup();
    expect(commitNoteName(engine, { ...input, value: "  " })).toEqual({
      kind: "restore",
    });
    expect(commitNoteName(engine, { ...input, value: "Projects" }).kind).toBe(
      "error",
    );
  });

  it("does nothing for a conflicted note", async () => {
    const { engine } = await setup();
    expect(
      commitNoteName(engine, { ...input, conflicted: true, value: "Hello" }),
    ).toEqual({ kind: "none" });
  });
});

describe("placeNode and undoPlace", () => {
  it("moves into another folder with a notice and an undo", async () => {
    const { engine } = await setup();
    const before = childNames(engine, []);
    const outcome = placeNode(engine, WELCOME, { parent: PROJECTS, before: null });
    expect(outcome).toEqual({
      kind: "placed",
      path: ["Projects", "Welcome"],
      notice: describeMovedTo("Welcome", PROJECTS),
      undo: {
        path: ["Projects", "Welcome"],
        parent: [],
        before: "Zażółć gęślą jaźń",
      },
    });
    if (outcome.kind !== "placed") return;
    expect(childNames(engine, [])).not.toContain("Welcome");

    expect(undoPlace(engine, outcome.undo).kind).toBe("ok");
    expect(childNames(engine, [])).toEqual(before);
  });

  it("gives no notice for a reorder within the same folder", async () => {
    const { engine } = await setup();
    const outcome = placeNode(engine, WELCOME, { parent: [], before: "Projects" });
    expect(outcome).toMatchObject({ kind: "placed", notice: null });
    expect(childNames(engine, [])).toEqual([
      "Empty folder",
      "Journal",
      "Welcome",
      "Projects",
      "Zażółć gęślą jaźń",
    ]);
  });

  it("reports a failed placement", async () => {
    const { engine } = await setup();
    const outcome = placeNode(engine, PROJECTS, {
      parent: ["Projects", "commitnote"],
      before: null,
    });
    expect(outcome.kind).toBe("error");
  });
});

describe("moveAmongSiblings", () => {
  it("does nothing at the edge", async () => {
    const { engine } = await setup();
    expect(moveAmongSiblings(engine, EMPTY_FOLDER, "up")).toEqual({ kind: "none" });
  });

  it("moves down with a notice and an undo that restores the order", async () => {
    const { engine } = await setup();
    const before = childNames(engine, []);
    const outcome = moveAmongSiblings(engine, EMPTY_FOLDER, "down");
    expect(outcome).toMatchObject({
      kind: "placed",
      notice: describeMovedDown("Empty folder"),
    });
    expect(childNames(engine, [])[0]).toBe("Journal");
    if (outcome.kind !== "placed") return;
    undoPlace(engine, outcome.undo);
    expect(childNames(engine, [])).toEqual(before);
  });
});

describe("trashNode", () => {
  it("trashes a note and Undo restores it", async () => {
    const { engine } = await setup();
    const outcome = await trashNode(trashDeps(engine), WELCOME, 0);
    expect(outcome).toMatchObject({
      kind: "trashed",
      path: WELCOME,
      notice: describeMovedToTrash("Welcome"),
    });
    if (outcome.kind !== "trashed") return;
    expect(exists(engine, WELCOME)).toBe(false);

    expect(undoTrash(engine, outcome.entryId, WELCOME)).toEqual({
      kind: "ok",
      reopen: null,
    });
    expect(exists(engine, WELCOME)).toBe(true);
  });

  it("asks to reopen the open note that an Undo brings back", async () => {
    const { engine } = await setup();
    await engine.openNote(WELCOME);
    const outcome = await trashNode(trashDeps(engine), WELCOME, 0);
    if (outcome.kind !== "trashed") throw new Error("expected trashed");
    expect(undoTrash(engine, outcome.entryId, WELCOME)).toEqual({
      kind: "ok",
      reopen: WELCOME,
    });
  });

  it("revokes the shares of a shared note before trashing it", async () => {
    const { engine } = await setup();
    engine.addShare(SHARE);
    expect(trashPreview(engine.getState(), WELCOME)).toEqual({
      itemCount: 0,
      shareCount: 1,
    });
    const revokeShares = vi.fn(async (): Promise<RevokeSharesResult> => {
      expect(exists(engine, WELCOME)).toBe(true);
      engine.removeShare(SHARE.id);
      return { ok: true, revoked: 1 };
    });

    const outcome = await trashNode(trashDeps(engine, revokeShares), WELCOME, 1);

    expect(outcome.kind).toBe("trashed");
    expect(revokeShares).toHaveBeenCalledWith(WELCOME);
    expect(exists(engine, WELCOME)).toBe(false);
  });

  it("reports shares that appeared after the confirmation without revoking", async () => {
    const { engine } = await setup();
    engine.addShare(SHARE);
    const revokeShares = vi.fn(async (): Promise<RevokeSharesResult> => ({
      ok: true,
      revoked: 1,
    }));

    const outcome = await trashNode(trashDeps(engine, revokeShares), WELCOME, 0);

    expect(outcome).toEqual({ kind: "sharesChanged", shareCount: 1 });
    expect(revokeShares).not.toHaveBeenCalled();
    expect(exists(engine, WELCOME)).toBe(true);
  });

  it("reports shares that remain after a revoke", async () => {
    const { engine } = await setup();
    engine.addShare(SHARE);
    const outcome = await trashNode(
      trashDeps(engine, async () => ({ ok: true, revoked: 0 })),
      WELCOME,
      1,
    );
    expect(outcome).toEqual({ kind: "sharesChanged", shareCount: 1 });
    expect(exists(engine, WELCOME)).toBe(true);
  });

  it("refuses a conflicted shared note before revoking", async () => {
    const { fake, engine } = await setup();
    engine.addShare(SHARE);
    await heldWelcomeConflict({ fake, engine });
    const revokeShares = vi.fn(async (): Promise<RevokeSharesResult> => ({
      ok: true,
      revoked: 1,
    }));

    const outcome = await trashNode(trashDeps(engine, revokeShares), WELCOME, 1);

    expect(outcome).toEqual({
      kind: "error",
      message: describeStructureError({ kind: "conflicted" }),
      shareCount: 1,
    });
    expect(revokeShares).not.toHaveBeenCalled();
  });

  it("trashes nothing when the revoke fails", async () => {
    const { engine } = await setup();
    engine.addShare(SHARE);
    const error = { kind: "server" } as const;

    const outcome = await trashNode(
      trashDeps(engine, async () => ({ ok: false, error, revoked: 0 })),
      WELCOME,
      1,
    );

    expect(outcome).toEqual({
      kind: "error",
      message: describeRevokeFailed(
        messageText(describeShareError(error, "github")),
        0,
      ),
      shareCount: 1,
    });
    expect(exists(engine, WELCOME)).toBe(true);
  });

  it("abandons the trash when the caller stops waiting", async () => {
    const { engine } = await setup();
    engine.addShare(SHARE);
    const outcome = await trashNode(
      {
        ...trashDeps(engine, async () => {
          engine.removeShare(SHARE.id);
          return { ok: true, revoked: 1 };
        }),
        proceed: () => false,
      },
      WELCOME,
      1,
    );
    expect(outcome).toEqual({ kind: "abandoned" });
    expect(exists(engine, WELCOME)).toBe(true);
  });

  it("deletes an empty folder without a trash entry", async () => {
    const { engine } = await setup();
    expect(trashPreview(engine.getState(), EMPTY_FOLDER).itemCount).toBe(0);
    expect(await trashNode(trashDeps(engine), EMPTY_FOLDER, 0)).toEqual({
      kind: "deleted",
      path: EMPTY_FOLDER,
    });
    expect(exists(engine, EMPTY_FOLDER)).toBe(false);
    expect(engine.getState().trash).toHaveLength(0);
  });

  it("counts the items of a folder", async () => {
    const { engine } = await setup();
    expect(trashPreview(engine.getState(), PROJECTS).itemCount).toBeGreaterThan(0);
  });
});

describe("trash restore and empty", () => {
  it("restores a sub-item of a trashed folder", async () => {
    const { engine } = await setup();
    const outcome = await trashNode(trashDeps(engine), PROJECTS, 0);
    if (outcome.kind !== "trashed") throw new Error("expected trashed");

    const restored = restoreFromTrash(
      engine,
      outcome.entryId,
      ["commitnote", "Roadmap"],
      [],
    );

    expect(restored).toEqual({ kind: "ok", path: ["Roadmap"] });
    expect(exists(engine, ["Roadmap"])).toBe(true);
  });

  it("empties the trash", async () => {
    const { engine } = await setup();
    await trashNode(trashDeps(engine), WELCOME, 0);
    expect(engine.getState().trash).toHaveLength(1);
    emptyTrash(engine);
    expect(engine.getState().trash).toHaveLength(0);
  });
});
