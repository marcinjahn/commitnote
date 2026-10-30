import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SHARE_LABEL_LENGTH } from "../share/share-label";
import {
  LINK_REVOKED_TEXT,
  SHARE_UNCHANGED_TEXT,
  SHARE_UPDATED_TEXT,
} from "../ui/share/share-messages";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../testing/sample-notes-repo/sample-source";
import type { CoreEvents, ShareRowView } from "./api";
import type { NativeCoreHandle } from "./api";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const REPO = "sample/notes";
const WELCOME = ["Welcome"];
const WHITEBOARD = ["Journal", "2026", "Whiteboard"];
const LINK_PREFIX = "https://commitnote.eu/app/#share=1.gh.";

let ctx: CoreTestContext;

beforeEach(async () => {
  ctx = await createCoreTestContext();
});

afterEach(() => {
  ctx.dispose();
});

async function started(): Promise<NativeCoreHandle> {
  const core = ctx.startCore();
  await ctx.logIn(core);
  return core;
}

function shareEvents(): CoreEvents["sharesChanged"][] {
  return ctx.events("sharesChanged") as CoreEvents["sharesChanged"][];
}

function lastShares(): CoreEvents["sharesChanged"] {
  const all = shareEvents();
  return all[all.length - 1]!;
}

function notices(): CoreEvents["notice"][] {
  return ctx.events("notice") as CoreEvents["notice"][];
}

function lastNotice(): CoreEvents["notice"] {
  const all = notices();
  return all[all.length - 1]!;
}

async function create(
  core: NativeCoreHandle,
  path: string[],
  password = "",
  label = "",
) {
  return (await ctx.call(core, "share.create", { path, password, label }))
    .outcome;
}

async function createdRow(
  core: NativeCoreHandle,
  path: string[] = WELCOME,
): Promise<ShareRowView> {
  expect((await create(core, path)).kind).toBe("created");
  return vi.waitFor(() => {
    const [row] = lastShares().shares;
    if (row === undefined) throw new Error("No row yet");
    return row;
  });
}

async function save(
  core: NativeCoreHandle,
  path: string[],
  text: string,
): Promise<void> {
  await ctx.call(core, "note.open", { path });
  await ctx.call(core, "note.edit", { path, text });
  expect(await ctx.call(core, "sync.flush")).toEqual({
    result: { kind: "saved" },
  });
}

describe("share.form", () => {
  it("titles the Share screen with the note name", async () => {
    const core = await started();
    expect(await ctx.call(core, "share.form", { path: WELCOME })).toEqual({
      title: "Share “Welcome”",
    });
  });

  it("rejects params that are not a note", async () => {
    const core = await started();
    expect((await ctx.send(core, "share.form", {})).ok).toBe(false);
    for (const path of [[], ["Nope"], ["Journal"]]) {
      const response = await ctx.send(core, "share.form", { path });
      expect(response).toMatchObject({
        ok: false,
        error: { kind: "invalidParams" },
      });
    }
  });
});

describe("share.create and sharesChanged", () => {
  it("creates a link with a share password and a share label", async () => {
    const core = await started();

    const outcome = await create(core, WELCOME, "hunter2", "For Sam");

    expect(outcome.kind).toBe("created");
    expect(outcome.link.startsWith(LINK_PREFIX)).toBe(true);
    expect(outcome.password).toBe("hunter2");
    await vi.waitFor(() => expect(lastShares().shares).toHaveLength(1));
    const [row] = lastShares().shares;
    expect(row).toMatchObject({
      title: "For Sam",
      label: "For Sam",
      passwordProtected: true,
      password: "hunter2",
      link: outcome.link,
      notePath: WELCOME,
      menuLabel: "Share actions for For Sam",
    });
    expect(row!.date).toMatch(/^Shared /);
    expect(row!.actions.map((action) => action.id)).toEqual([
      "copy-link",
      "copy-password",
      "update",
      "view",
      "open",
      "rename",
      "revoke",
    ]);
    expect(row!.actions.find((a) => a.id === "revoke")).toMatchObject({
      destructive: true,
      disabled: false,
    });
  });

  it("emits the Shared links copy before any share exists", async () => {
    const core = await started();
    await ctx.call(core, "tree.get");

    expect(lastShares()).toMatchObject({
      shares: [],
      unreadable: null,
      updatingId: null,
      copy: {
        sharedLinksTitle: "Shared links",
        revoke: { confirmLabel: "Revoke" },
      },
    });
    expect(lastShares().copy.explanation).toContain("secret gist");
  });

  it("omits the password for a link without one", async () => {
    const core = await started();
    const row = await createdRow(core);
    expect(row).toMatchObject({
      title: "Welcome",
      label: null,
      passwordProtected: false,
      password: null,
    });
    expect(row.actions.map((action) => action.id)).not.toContain(
      "copy-password",
    );
  });

  it("shares a note with an image", async () => {
    const core = await started();
    const outcome = await create(core, WHITEBOARD);
    expect(outcome.kind).toBe("created");
  });

  it("explains a GitHub token without gist permission", async () => {
    const core = await started();
    ctx.controls.failNext(REPO, "createShare", "Forbidden");

    const outcome = await create(core, WELCOME);

    expect(outcome.kind).toBe("error");
    expect(outcome.parts[0].text).toContain(
      "Sharing needs permission to create gists",
    );
    expect(
      outcome.parts.filter((part: { kind: string }) => part.kind === "link"),
    ).toEqual([
      expect.objectContaining({
        href: "https://github.com/settings/personal-access-tokens",
      }),
      expect.objectContaining({ href: "https://github.com/settings/tokens" }),
    ]);
    expect(lastShares().shares).toEqual([]);
  });

  it("explains a GitLab token without the api scope", async () => {
    const core = ctx.startCore();
    const token = "test-token";
    await ctx.call(core, "login.listRepositories", {
      forge: "gitlab",
      accessToken: token,
    });
    await ctx.call(core, "login.inspectRepository", {
      forge: "gitlab",
      accessToken: token,
      repositoryUrl: "https://fakelab.test/team/notes",
    });
    await ctx.call(core, "login.unlock", {
      passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
    });
    ctx.controls.failNext("team/notes", "createShare", "Forbidden");

    const outcome = await create(core, WELCOME);

    expect(outcome.kind).toBe("error");
    expect(outcome.parts[0].text).toContain(
      "Sharing needs an access token with the api scope",
    );
    expect(outcome.parts[1]).toEqual({
      kind: "link",
      text: "gitlab.com/-/user_settings/personal_access_tokens",
      href: "https://gitlab.com/-/user_settings/personal_access_tokens",
    });
  });
});

describe("share.update", () => {
  it("reports an unchanged note, then the update after a save", async () => {
    const core = await started();
    const row = await createdRow(core);

    await ctx.call(core, "share.update", { id: row.id });
    expect(lastNotice()).toMatchObject({
      tone: "info",
      message: SHARE_UNCHANGED_TEXT,
    });

    await save(core, WELCOME, "Edited once\n");
    await ctx.call(core, "share.update", { id: row.id });
    expect(lastNotice()).toMatchObject({
      tone: "success",
      message: SHARE_UPDATED_TEXT,
    });
    await vi.waitFor(() =>
      expect(lastShares().shares[0]!.date).toMatch(/^Updated /),
    );
  });

  it("runs one update at a time", async () => {
    const core = await started();
    const row = await createdRow(core);
    await save(core, WELCOME, "Edited once\n");
    const before = notices().length;
    ctx.controls.hold(REPO, "updateShare");

    const first = ctx.call(core, "share.update", { id: row.id });
    await vi.waitFor(() => expect(lastShares().updatingId).toBe(row.id));
    expect(
      lastShares()
        .shares[0]!.actions.find((action) => action.id === "update")!.disabled,
    ).toBe(true);
    await ctx.call(core, "share.update", { id: row.id });
    expect(notices()).toHaveLength(before);

    ctx.controls.release(REPO, "updateShare");
    await first;

    expect(lastShares().updatingId).toBeNull();
    expect(notices()).toHaveLength(before + 1);
    expect(lastNotice().message).toBe(SHARE_UPDATED_TEXT);
  });
});

describe("share.rename", () => {
  it("renames a link", async () => {
    const core = await started();
    const row = await createdRow(core);

    expect(
      await ctx.call(core, "share.rename", { id: row.id, label: "Team" }),
    ).toEqual({ outcome: { kind: "ok" } });

    await vi.waitFor(() => expect(lastShares().shares[0]!.title).toBe("Team"));
  });

  it("rejects a label over the length limit", async () => {
    const core = await started();
    const row = await createdRow(core);

    const { outcome } = await ctx.call(core, "share.rename", {
      id: row.id,
      label: "x".repeat(MAX_SHARE_LABEL_LENGTH + 1),
    });

    expect(outcome).toEqual({
      kind: "error",
      message: `Use ${MAX_SHARE_LABEL_LENGTH} characters or fewer.`,
    });
  });
});

describe("share.revoke", () => {
  it("removes the row and posts a notice", async () => {
    const core = await started();
    const row = await createdRow(core);

    await ctx.call(core, "share.revoke", { id: row.id });

    expect(lastNotice()).toMatchObject({
      tone: "success",
      message: LINK_REVOKED_TEXT,
    });
    await vi.waitFor(() => expect(lastShares().shares).toEqual([]));
  });

  it("posts the error when the forge refuses", async () => {
    const core = await started();
    const row = await createdRow(core);
    ctx.controls.failNext(REPO, "deleteShare", "Network");

    await ctx.call(core, "share.revoke", { id: row.id });

    expect(lastNotice().tone).toBe("error");
    expect(lastNotice().message).toContain("Couldn't reach GitHub");
    expect(lastShares().shares).toHaveLength(1);
  });
});

describe("share.sharedVersion", () => {
  it("reads the content at share time", async () => {
    const core = await started();
    const { note } = await ctx.call(core, "note.open", { path: WELCOME });
    const row = await createdRow(core);
    await save(core, WELCOME, "Changed after sharing\n");

    const { outcome } = await ctx.call(core, "share.sharedVersion", {
      id: row.id,
    });

    expect(outcome).toMatchObject({ kind: "readable", content: note.content });
    expect(outcome.date).toMatch(/^Shared /);
  });

  it("says the link is gone for an unknown id", async () => {
    const core = await started();
    expect(
      await ctx.call(core, "share.sharedVersion", { id: "missing" }),
    ).toEqual({
      outcome: {
        kind: "message",
        message: "This link is no longer in your shared links.",
      },
    });
  });
});
