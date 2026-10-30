import { beforeAll, describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { TRASH_RETENTION_MS } from "../format/v1";
import {
  createNoteHistory,
  type NoteVersion,
} from "../history/note-history";
import { type ImageId, imageFilePath } from "../images/image-id";
import { formatImageReference } from "../images/image-reference";
import { createPendingImage, type PendingImage } from "../images/pending-image";
import { createSyncEngine, type SyncEngine } from "../sync/sync-engine";
import {
  IDEAS,
  WELCOME,
  heldWelcomeConflict,
  mainContent,
  welcomeText,
} from "../sync/testing/engine-harness";
import { createTestClock } from "../sync/testing/test-clock";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { describeStructureError } from "../ui/browse/structure-messages";
import { describeNameError } from "../ui/dialogs/name-messages";
import {
  describeRestored,
  UNSAVED_BEFORE_RESTORE_MESSAGE,
} from "../ui/history/history-messages";
import { draftSiblingNames } from "./note-draft-actions";
import {
  historyTarget,
  restoreVersion,
  setNoteState,
  undoRestore,
  undoRestoreApplies,
  type RestoreDeps,
} from "./history-actions";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

const NOW = 5_000_000;

function versionAt(sha: string, committedAt = NOW - 1000): NoteVersion {
  return { sha, committedAt, storedPath: "n", name: "Note", events: [] };
}

async function setup(open: NotePath | null = WELCOME) {
  const fake = await createSampleNotesRepoAdapter();
  const engine = createSyncEngine({
    adapter: fake,
    keyring,
    clock: createTestClock(1_000_000),
  });
  await engine.refresh();
  if (open !== null) await engine.openNote(open);
  return { fake, engine };
}

function depsOf(
  engine: SyncEngine,
  fake: FakeForgeAdapter,
  flush: SyncEngine["flush"] = () => engine.flush(),
): RestoreDeps {
  return {
    engine: {
      flush,
      getState: () => engine.getState(),
      getPendingImage: (id) => engine.getPendingImage(id),
      addRestoredImages: (shas) => engine.addRestoredImages(shas),
      editNote: (path, content) => engine.editNote(path, content),
      rename: (path, name) => engine.rename(path, name),
    },
    noteHistory: createNoteHistory({ adapter: fake, keyring }),
    siblingNames: (parent, exclude) =>
      draftSiblingNames(engine.getState().workingTree, parent).filter(
        (name) => name !== exclude,
      ),
  };
}

function openContent(engine: SyncEngine): string | undefined {
  const open = engine.getState().openNote;
  return open?.kind === "loaded" ? open.content : undefined;
}

function restoreInput(
  plan: { content: string | null; name: string | null },
  overrides: { isCurrent?: () => boolean; version?: NoteVersion } = {},
) {
  return {
    path: WELCOME,
    plan: { kind: "ready" as const, ...plan },
    version: overrides.version ?? versionAt("v1"),
    isCurrent: overrides.isCurrent ?? (() => true),
    now: () => NOW,
  };
}

describe("historyTarget", () => {
  it("is ready on the synced head for a saved note", async () => {
    const { fake, engine } = await setup();
    expect(await historyTarget(engine, WELCOME)).toEqual({
      kind: "ready",
      head: fake.repo.getRef("main")!,
    });
  });

  it("flushes unsaved edits first", async () => {
    const { fake, engine } = await setup();
    engine.editNote(WELCOME, "edited");
    const target = await historyTarget(engine, WELCOME);
    expect(target).toEqual({ kind: "ready", head: fake.repo.getRef("main")! });
    expect(await mainContent(fake, WELCOME)).toBe("edited");
  });

  it("is unsaved for a note that is not in the synced tree", async () => {
    const { engine } = await setup();
    expect(await historyTarget(engine, ["Nope"])).toEqual({ kind: "unsaved" });
  });
});

describe("setNoteState", () => {
  it("reports a conflicted note without changing it", async () => {
    const { fake, engine } = await setup(null);
    await heldWelcomeConflict({ fake, engine });
    await engine.openNote(WELCOME);
    const before = openContent(engine);
    expect(
      setNoteState(depsOf(engine, fake), WELCOME, "other", null),
    ).toEqual({
      ok: false,
      message: describeStructureError({ kind: "conflicted" }),
    });
    expect(openContent(engine)).toBe(before);
  });
});

describe("restoreVersion", () => {
  it("restores the content and keeps the title", async () => {
    const { fake, engine } = await setup();
    const original = openContent(engine)!;
    const outcome = await restoreVersion(
      depsOf(engine, fake),
      restoreInput({ content: "older text", name: null }),
    );
    expect(outcome).toEqual({
      kind: "restored",
      path: WELCOME,
      message: describeRestored(NOW - 1000, NOW),
      undo: { path: WELCOME, content: original, name: null },
      guard: { path: WELCOME, content: "older text" },
    });
    expect(openContent(engine)).toBe("older text");
  });

  it("restores the content and the title together", async () => {
    const { fake, engine } = await setup();
    const original = openContent(engine)!;
    const outcome = await restoreVersion(
      depsOf(engine, fake),
      restoreInput({ content: "older text", name: "Hello" }),
    );
    expect(outcome).toMatchObject({
      kind: "restored",
      path: ["Hello"],
      undo: { path: ["Hello"], content: original, name: "Welcome" },
    });
    expect(await engine.flush()).toEqual({ kind: "saved" });
    expect(await mainContent(fake, ["Hello"])).toBe("older text");
  });

  it("leaves the content alone when the title is taken", async () => {
    const { fake, engine } = await setup();
    const original = openContent(engine)!;
    const outcome = await restoreVersion(
      depsOf(engine, fake),
      restoreInput({ content: "older text", name: "Projects" }),
    );
    expect(outcome).toEqual({
      kind: "error",
      message: describeNameError({ kind: "duplicate" }),
    });
    expect(openContent(engine)).toBe(original);
  });

  it("refuses a note that has unsaved changes", async () => {
    const { fake, engine } = await setup();
    const deps = depsOf(engine, fake, async () => {
      engine.editNote(WELCOME, "typed during the flush");
      return { kind: "saved" };
    });
    expect(
      await restoreVersion(deps, restoreInput({ content: "older", name: null })),
    ).toEqual({ kind: "error", message: UNSAVED_BEFORE_RESTORE_MESSAGE });
    expect(openContent(engine)).toBe("typed during the flush");
  });

  it("is stale when the dialog is closed during the flush", async () => {
    const { fake, engine } = await setup();
    const original = openContent(engine)!;
    let current = true;
    const deps = depsOf(engine, fake, async () => {
      current = false;
      return { kind: "saved" };
    });
    const outcome = await restoreVersion(
      deps,
      restoreInput(
        { content: "older", name: null },
        { isCurrent: () => current },
      ),
    );
    expect(outcome).toEqual({ kind: "stale" });
    expect(openContent(engine)).toBe(original);
  });

  it("is stale when another note is open", async () => {
    const { fake, engine } = await setup(IDEAS);
    expect(
      await restoreVersion(
        depsOf(engine, fake),
        restoreInput({ content: "older", name: null }),
      ),
    ).toEqual({ kind: "stale" });
  });

  it("brings back an image deleted since the version was saved", async () => {
    const fake = await createSampleNotesRepoAdapter();
    const clock = createTestClock(1_000_000);
    const engine = createSyncEngine({
      adapter: delegateAdapter(fake, {}),
      keyring,
      clock,
    });
    await engine.refresh();
    await engine.openNote(WELCOME);
    const head = () => fake.repo.getRef("main")!;

    const original = await welcomeText(fake);
    const image: PendingImage = await createPendingImage(keyring, {
      type: "image/webp",
      width: 4,
      height: 3,
      bytes: Uint8Array.from({ length: 64 }, (_, i) => i),
    });
    const withImage = withReference(original, image.imageId);
    engine.addPendingImage(image);
    engine.editNote(WELCOME, withImage);
    expect(await engine.flush()).toEqual({ kind: "saved" });
    const versionWithImage = head();

    engine.editNote(WELCOME, original);
    expect(await engine.flush()).toEqual({ kind: "saved" });
    clock.advance(TRASH_RETENTION_MS + 60_000);
    const other: PendingImage = await createPendingImage(keyring, {
      type: "image/webp",
      width: 4,
      height: 3,
      bytes: Uint8Array.from({ length: 64 }, (_, i) => i + 100),
    });
    engine.addPendingImage(other);
    engine.editNote(
      IDEAS,
      withReference((await mainContent(fake, IDEAS))!, other.imageId),
    );
    expect(await engine.flush()).toEqual({ kind: "saved" });
    expect(engine.getState().synced!.images.images.has(image.imageId)).toBe(
      false,
    );

    const outcome = await restoreVersion(
      depsOf(engine, fake),
      restoreInput(
        { content: withImage, name: null },
        { version: versionAt(versionWithImage) },
      ),
    );
    expect(outcome.kind).toBe("restored");
    expect(await engine.flush()).toEqual({ kind: "saved" });
    expect(fake.repo.fileAt(head(), imageFilePath(image.imageId))).toBe(
      image.blobSha,
    );
  });
});

function withReference(text: string, imageId: ImageId): string {
  return `${text}\n\n${formatImageReference({ imageId, alt: "Diagram", width: 4, height: 3 })}\n`;
}

describe("undoing a restore", () => {
  it("puts back exactly the changed steps", async () => {
    const { fake, engine } = await setup();
    const original = openContent(engine)!;
    const deps = depsOf(engine, fake);
    const restored = await restoreVersion(
      deps,
      restoreInput({ content: "older text", name: "Hello" }),
    );
    if (restored.kind !== "restored") throw new Error("expected restored");
    expect(undoRestore(deps, restored.undo)).toEqual({
      ok: true,
      path: WELCOME,
    });
    expect(openContent(engine)).toBe(original);
    expect(await engine.flush()).toEqual({ kind: "saved" });
    expect(await mainContent(fake, WELCOME)).toBe(original);
  });

  it("leaves the title alone when only the content was restored", async () => {
    const { fake, engine } = await setup();
    const original = openContent(engine)!;
    const deps = depsOf(engine, fake);
    const restored = await restoreVersion(
      deps,
      restoreInput({ content: "older text", name: null }),
    );
    if (restored.kind !== "restored") throw new Error("expected restored");
    expect(restored.undo.name).toBeNull();
    expect(undoRestore(deps, restored.undo)).toEqual({
      ok: true,
      path: WELCOME,
    });
    expect(openContent(engine)).toBe(original);
  });

  it("no longer applies after further typing", async () => {
    const { fake, engine } = await setup();
    const restored = await restoreVersion(
      depsOf(engine, fake),
      restoreInput({ content: "older text", name: null }),
    );
    if (restored.kind !== "restored" || restored.guard === null) {
      throw new Error("expected a guard");
    }
    expect(undoRestoreApplies(restored.guard, engine.getState().openNote)).toBe(
      true,
    );
    engine.editNote(WELCOME, "older text, then more");
    expect(undoRestoreApplies(restored.guard, engine.getState().openNote)).toBe(
      false,
    );
  });
});
