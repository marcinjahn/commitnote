import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyKeyCheck } from "../crypto/keyring";
import { parseRepoConfig } from "../crypto/repo-config";
import { sharedMemoizedArgon2id } from "../crypto/testing/shared-argon2id";
import { REPO_CONFIG_PATH } from "../format/v1";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../testing/sample-notes-repo/sample-source";
import {
  describeChangeAtomicSetup,
  describeChangeFailure,
  describeChangeStep,
  describeRemoveHistory,
  HISTORY_REMOVED_MESSAGE,
  LOG_OUT_LABEL,
  PASSPHRASE_CHANGED_MESSAGE,
  REMOVE_HISTORY_REVIEW,
} from "../ui/passphrase/passphrase-messages";
import { ENABLE_ATOMIC_LABEL } from "../ui/import/import-messages";
import { readBackNativeRepo } from "../../scripts/native-core/read-back";
import type { NativeCoreHandle } from "./api";
import type { AppSession, NativeRunningApp } from "./app-session";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const REPO = "sample/notes";
const WELCOME = ["Welcome"];
const PROJECTS = ["Projects"];
const NEW_PASSPHRASE = "a brand new native passphrase";
const NOW = Date.UTC(2026, 9, 1, 12);

let ctx: CoreTestContext;
let app: AppSession;

afterEach(() => {
  ctx.dispose();
});

async function started(): Promise<NativeCoreHandle> {
  ctx = await createCoreTestContext();
  const core = ctx.startCore(undefined, (session) => {
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

function prepare(
  core: NativeCoreHandle,
  options: { current?: string; removeHistory?: boolean } = {},
): Promise<any> {
  return ctx.call(core, "passphrase.prepareChange", {
    current: options.current ?? SAMPLE_NOTES_REPO_PASSPHRASE,
    next: NEW_PASSPHRASE,
    removeHistory: options.removeHistory ?? false,
  });
}

function commitCount(): number {
  return ctx.controls.commitMessages(REPO).length;
}

async function editSaves(core: NativeCoreHandle, text: string) {
  await ctx.call(core, "note.open", { path: WELCOME });
  const before = commitCount();
  await ctx.call(core, "note.edit", { path: WELCOME, text });
  expect(await ctx.call(core, "sync.flush")).toEqual({
    result: { kind: "saved" },
  });
  expect(commitCount()).toBe(before + 1);
}

function notices(): { tone: string; message: string }[] {
  return ctx.events("notice") as { tone: string; message: string }[];
}

async function headConfig() {
  const adapter = current().sourceAdapter;
  const file = await adapter.readFileAt(
    await adapter.getHead(),
    REPO_CONFIG_PATH,
  );
  const parsed = parseRepoConfig(file?.text ?? "");
  if (parsed.kind !== "valid") throw new Error("expected a valid config");
  return parsed.config;
}

describe("passphrase change", () => {
  it("re-encrypts the notes repo and restarts the app on the new key", async () => {
    const core = await started();
    await ctx.call(core, "lastView.save", {
      note: WELCOME,
      folders: [PROJECTS],
    });
    ctx.clock.advance(1_000);
    await vi.waitFor(async () =>
      expect((await ctx.call(core, "lastView.load")).view.folders).toEqual([
        PROJECTS,
      ]),
    );

    const form = await ctx.call(core, "passphrase.changeForm");
    expect(form).toMatchObject({
      canRemoveHistory: true,
      repositoryLabel: "sample/notes",
      copy: {
        title: "Change passphrase",
        removeHistoryLabel: "Also delete the old history",
        removeHistoryDescription: describeRemoveHistory("GitHub"),
        enableAtomicLabel: ENABLE_ATOMIC_LABEL,
        logOutLabel: LOG_OUT_LABEL,
      },
    });

    const { outcome } = await prepare(core);
    const progress = ctx.events("passphraseChangeProgress") as {
      message: string;
      done: number | null;
      total: number | null;
    }[];
    expect(progress[0]).toEqual({
      message: describeChangeStep({ kind: "saving" }),
      done: null,
      total: null,
    });
    const messages = progress.map((step) => step.message);
    expect(messages).toContain(describeChangeStep({ kind: "derivingKeys" }));
    expect(messages).toContain(describeChangeStep({ kind: "verifying" }));
    const reading = progress.find((step) => step.message.startsWith("Reading"));
    expect(reading?.total).toBeGreaterThan(0);
    expect(reading?.message).toBe(
      describeChangeStep({
        kind: "reading",
        done: reading!.done!,
        total: reading!.total!,
      }),
    );
    expect(outcome).toMatchObject({ kind: "review", historyWarning: null });
    expect(outcome.summary).toMatch(/^Re-encrypts \d+ notes, /);
    expect(Array.isArray(outcome.carriedOver)).toBe(true);

    const old = current();
    expect(await ctx.call(core, "passphrase.commitChange")).toEqual({
      outcome: { kind: "changed" },
    });
    expect(current()).not.toBe(old);
    expect(notices().at(-1)).toMatchObject({
      tone: "success",
      message: PASSPHRASE_CHANGED_MESSAGE,
    });

    const config = await headConfig();
    expect(await verifyKeyCheck(current().session.keyring, config)).toBe(true);
    const remembered = await app.store.loadRememberedSession();
    expect(remembered).not.toBeNull();
    expect(await verifyKeyCheck(remembered!.keyring, config)).toBe(true);

    await vi.waitFor(async () =>
      expect((await ctx.call(core, "lastView.load")).view).toEqual({
        note: WELCOME,
        folders: [PROJECTS],
      }),
    );

    await editSaves(core, "After the change");

    expect(
      await readBackNativeRepo(
        {
          name: "passphrase change",
          passphrase: NEW_PASSPHRASE,
          exported: ctx.controls.exportRepo(REPO),
          expect: {
            initialized: false,
            notes: [{ path: WELCOME, text: "After the change" }],
            folders: [PROJECTS],
            deviceName: "iPhone",
          },
        },
        { argon2id: sharedMemoizedArgon2id },
      ),
    ).toEqual([]);

    const fresh = ctx.startCore();
    await ctx.inspect(fresh, REPO);
    expect(
      await ctx.send(fresh, "login.unlock", {
        passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
      }),
    ).toMatchObject({ ok: false, error: { kind: "wrongPassphrase" } });
    expect(
      await ctx.call(fresh, "login.unlock", { passphrase: NEW_PASSPHRASE }),
    ).toEqual({ kind: "loggedIn" });
  });

  it("deletes the old history when asked", async () => {
    const core = await started();
    const { outcome } = await prepare(core, { removeHistory: true });
    expect(outcome).toMatchObject({
      kind: "review",
      historyWarning: REMOVE_HISTORY_REVIEW,
    });
    expect(await ctx.call(core, "passphrase.commitChange")).toEqual({
      outcome: { kind: "changed" },
    });
    expect(notices().at(-1)).toMatchObject({
      tone: "success",
      message: HISTORY_REMOVED_MESSAGE,
    });
    expect(commitCount()).toBe(1);
  });

  it("clears the current passphrase field after a wrong one", async () => {
    const core = await started();
    expect(await prepare(core, { current: "not the passphrase" })).toEqual({
      outcome: {
        kind: "failed",
        message: describeChangeFailure(
          { kind: "wrongPassphrase" },
          "GitHub",
          NOW,
        ),
        clearCurrent: true,
      },
    });
    await editSaves(core, "Still writable");
  });

  it("refuses while edits are unsaved or in conflict", async () => {
    const core = await started();
    await ctx.call(core, "note.open", { path: WELCOME });
    await ctx.call(core, "lifecycle.setOnline", { online: false });
    await ctx.call(core, "note.edit", { path: WELCOME, text: "Offline" });
    expect(await prepare(core)).toEqual({
      outcome: {
        kind: "failed",
        message: describeChangeFailure(
          { kind: "unsaved", count: 1 },
          "GitHub",
          NOW,
        ),
        clearCurrent: false,
      },
    });

    await ctx.controls.editNote(REPO, WELCOME, "Theirs", undefined, "Other");
    await ctx.call(core, "lifecycle.setOnline", { online: true });
    await ctx.call(core, "sync.flush");
    await vi.waitFor(() =>
      expect(current().engine.getState().conflicts).toHaveLength(1),
    );
    expect(await prepare(core)).toEqual({
      outcome: {
        kind: "failed",
        message: describeChangeFailure({ kind: "conflicts" }, "GitHub", NOW),
        clearCurrent: false,
      },
    });
  });

  it("cancels a held change, replaces it on a second prepare and drops it on logout", async () => {
    const core = await started();
    expect((await prepare(core)).outcome.kind).toBe("review");
    expect(current().engine.getState().suspended).toBe(true);
    await ctx.call(core, "passphrase.cancelChange");
    expect(current().engine.getState().suspended).toBe(false);
    await editSaves(core, "After cancelling");

    expect((await prepare(core)).outcome.kind).toBe("review");
    expect((await prepare(core)).outcome.kind).toBe("review");
    expect(current().engine.getState().suspended).toBe(true);

    await ctx.call(core, "session.logout", { anyway: true });
    await ctx.logIn(core);
    expect(await ctx.send(core, "passphrase.commitChange")).toMatchObject({
      ok: false,
      error: { kind: "notReady" },
    });
    await editSaves(core, "After logging back in");
  });

  it("rejects overlapping change commands while one runs", async () => {
    const core = await started();
    ctx.controls.hold(REPO, "listTree");
    const preparing = prepare(core, { current: "not the passphrase" });
    await vi.waitFor(() =>
      expect(ctx.events("passphraseChangeProgress")).toHaveLength(1),
    );
    expect(await ctx.send(core, "passphrase.cancelChange")).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
    ctx.controls.release(REPO, "listTree");
    expect((await preparing).outcome.kind).toBe("failed");
  });

  it("asks for fast-forward merges and prepares again once they are enabled", async () => {
    const core = await started();
    const adapter = current().adapter as {
      atomicCommitSupport?: () => Promise<unknown>;
      enableAtomicCommits?: () => Promise<unknown>;
    };
    let support: { kind: string; canConfigure?: boolean } = {
      kind: "needsSetup",
      canConfigure: true,
    };
    adapter.atomicCommitSupport = async () => support;
    adapter.enableAtomicCommits = async () => {
      support = { kind: "available" };
      return support;
    };

    expect(await prepare(core)).toEqual({
      outcome: {
        kind: "needsSetup",
        canConfigure: true,
        message: describeChangeAtomicSetup("GitHub", true),
        actionLabel: ENABLE_ATOMIC_LABEL,
      },
    });
    expect(current().engine.getState().suspended).toBe(false);
    expect(await ctx.call(core, "passphrase.enableAtomic")).toEqual({
      error: null,
    });
    expect((await prepare(core)).outcome.kind).toBe("review");
  });

  it("keeps editing paused while the outcome is unknown", async () => {
    const core = await started();
    expect((await prepare(core)).outcome.kind).toBe("review");
    ctx.controls.failNext(REPO, "commit", "Network");
    const unsettled = {
      outcome: {
        kind: "unsettled",
        message: describeChangeFailure(
          { kind: "outcomeUnknown" },
          "GitHub",
          NOW,
        ),
      },
    };
    expect(await ctx.call(core, "passphrase.commitChange")).toEqual(unsettled);
    await ctx.call(core, "passphrase.cancelChange");
    expect(current().engine.getState().suspended).toBe(true);
    expect(await ctx.call(core, "passphrase.settle")).toEqual(unsettled);
    expect(await ctx.send(core, "passphrase.commitChange")).toMatchObject({
      ok: false,
      error: { kind: "notReady" },
    });
  });
});
