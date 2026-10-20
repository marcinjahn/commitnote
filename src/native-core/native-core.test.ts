import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForgeRegistry } from "../forge/registry";
import { AUTO_REFRESH_THROTTLE_MS } from "../sync/tuning";
import {
  FAKE_FORGE_INVALID_TOKEN,
  FAKE_FORGE_NO_REPOSITORIES_TOKEN,
  type FakeForgeControls,
} from "../testing/fake-forge/fake-forge-factory";
import {
  SAMPLE_NOTES_REPO_PASSPHRASE,
  sampleNotesRepoSource,
  type SampleEntry,
} from "../testing/sample-notes-repo/sample-source";
import { KEY_CHANGED_MESSAGE } from "../ui/browse/sync-messages";
import {
  DEFAULT_ACCESS_TOKEN_HINT,
  FOREIGN_REPOSITORY_HINT,
  PUBLIC_REPOSITORY_WARNING,
} from "../ui/login/login-messages";
import { CORE_COMMAND_NAMES, type NativeCoreHandle } from "./api";
import { UNKNOWN_REQUEST_ID } from "./native-core";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";
import type { NodeHostServices } from "./testing/node-host-services";

const TOKEN = "test-token";
const SAMPLE_URL = "https://github.com/sample/notes";

let ctx: CoreTestContext;
let host: NodeHostServices;
let clock: CoreTestContext["clock"];
let registry: ForgeRegistry;
let controls: FakeForgeControls;
let cores: NativeCoreHandle[];

beforeEach(async () => {
  ctx = await createCoreTestContext({
    extraCommands: {
      "test.throw": () => Promise.reject(new TypeError("boom")),
    },
  });
  ({ host, clock, registry, controls, cores } = ctx);
});

afterEach(() => {
  ctx.dispose();
});

const startCore: CoreTestContext["startCore"] = (...args) =>
  ctx.startCore(...args);
const events: CoreTestContext["events"] = (name) => ctx.events(name);
const responsesTo: CoreTestContext["responsesTo"] = (id) => ctx.responsesTo(id);
const sendRaw: CoreTestContext["sendRaw"] = (...args) => ctx.sendRaw(...args);
const send: CoreTestContext["send"] = (...args) => ctx.send(...args);
const call: CoreTestContext["call"] = (...args) => ctx.call(...args);
const inspect: CoreTestContext["inspect"] = (...args) => ctx.inspect(...args);
const logIn: CoreTestContext["logIn"] = (...args) => ctx.logIn(...args);

describe("native core requests", () => {
  it("answers malformed JSON with invalidParams under the unknown request id", async () => {
    const response = await sendRaw(
      startCore(),
      "{not json",
      UNKNOWN_REQUEST_ID,
    );
    expect(response).toMatchObject({
      ok: false,
      error: { kind: "invalidParams", transient: false },
    });
  });

  it("answers a request without params with invalidParams", async () => {
    const response = await sendRaw(
      startCore(),
      JSON.stringify({ id: 900, command: "forges.list" }),
      900,
    );
    expect(response).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
  });

  it("answers wrongly typed params with invalidParams", async () => {
    const response = await send(startCore(), "login.listRepositories", {
      forge: "bitbucket",
      accessToken: TOKEN,
    });
    expect(response).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
  });

  it("answers an unknown command with unknownCommand", async () => {
    const response = await send(startCore(), "notes.delete");
    expect(response).toMatchObject({
      ok: false,
      error: {
        kind: "unknownCommand",
        message: "Something went wrong. Try again.",
      },
    });
  });

  it("answers a failing command with internal and logs only its name and the error name", async () => {
    const response = await send(startCore(), "test.throw");
    expect(response).toMatchObject({ ok: false, error: { kind: "internal" } });
    expect(host.logs).toEqual([
      { level: "error", message: "Command test.throw failed: TypeError" },
    ]);
  });

  it("posts exactly one response per request", async () => {
    const core = startCore();
    const response = await send(core, "forges.list");
    await call(core, "login.lastRepository");
    expect(responsesTo(response.id)).toHaveLength(1);
  });

  it("ignores requests after stop", async () => {
    const core = startCore();
    core.stop();
    core.send(JSON.stringify({ id: 901, command: "forges.list", params: {} }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.posted).toEqual([]);
  });
});

describe("login commands", () => {
  it("lists the forges with their token hints and creation URLs", async () => {
    const withoutHint: ForgeRegistry = {
      ...registry,
      gitlab: { ...registry.gitlab, accessTokenHint: undefined },
    };
    const { forges } = await call(startCore(withoutHint), "forges.list");
    expect(forges).toEqual([
      expect.objectContaining({
        id: "github",
        name: "GitHub",
        accessTokenHint: registry.github.accessTokenHint,
      }),
      {
        id: "gitlab",
        name: "Fakelab",
        accessTokenHint: DEFAULT_ACCESS_TOKEN_HINT,
        accessTokenCreationUrl: "https://fakelab.test/tokens/new",
        repositoryCreationUrl: "https://fakelab.test/projects/new",
      },
    ]);
    expect(forges[0].accessTokenCreationUrl).toContain("2026-10-01");
  });

  it("lists repositories and reports progress", async () => {
    const { repositories } = await call(startCore(), "login.listRepositories", {
      forge: "github",
      accessToken: TOKEN,
    });
    expect(repositories).toContainEqual({
      url: SAMPLE_URL,
      label: "sample/notes",
      private: true,
    });
    expect(repositories).toContainEqual({
      url: "https://github.com/sample/public-empty",
      label: "sample/public-empty",
      private: false,
    });
    expect(events("loadingProgress")).toEqual([
      { step: "listingRepositories", message: "Loading repositories…" },
    ]);
  });

  it("answers an invalid token with an unauthorized error", async () => {
    const response = await send(startCore(), "login.listRepositories", {
      forge: "github",
      accessToken: FAKE_FORGE_INVALID_TOKEN,
    });
    expect(response).toMatchObject({
      ok: false,
      error: {
        kind: "unauthorized",
        message: "The access token is invalid or has expired.",
        transient: false,
      },
    });
  });

  it("lists no repositories for a token without any", async () => {
    expect(
      await call(startCore(), "login.listRepositories", {
        forge: "github",
        accessToken: FAKE_FORGE_NO_REPOSITORIES_TOKEN,
      }),
    ).toEqual({ repositories: [] });
  });

  it("returns the last repository as unknown before any login", async () => {
    expect(await call(startCore(), "login.lastRepository")).toEqual({
      repoUrl: null,
      forge: null,
    });
  });

  it("inspects a notes repo", async () => {
    expect(await inspect(startCore(), "sample/notes")).toEqual({
      kind: "notesRepo",
      repository: {
        label: "sample/notes",
        url: SAMPLE_URL,
        private: true,
        publicWarning: null,
      },
    });
    expect(events("loadingProgress")).toContainEqual({
      step: "checkingRepository",
      message: "Checking repository…",
    });
  });

  it("inspects an empty repository with its set-up description", async () => {
    expect(await inspect(startCore(), "sample/empty")).toMatchObject({
      kind: "uninitialized",
      setUpDescription:
        "This repository is empty. Setting it up as a notes repo adds a commitnote configuration file and a README.",
    });
  });

  it("warns about a public repository", async () => {
    expect(await inspect(startCore(), "sample/public-empty")).toMatchObject({
      kind: "uninitialized",
      repository: { private: false, publicWarning: PUBLIC_REPOSITORY_WARNING },
    });
  });

  it("reports a notes repo of a newer format as unusable", async () => {
    expect(await inspect(startCore(), "sample/newer")).toEqual({
      kind: "unusable",
      repository: expect.objectContaining({ label: "sample/newer" }),
      error: {
        kind: "newerFormat",
        message:
          "This notes repo was created by a newer version of commitnote. Update the app to open it.",
        transient: false,
        formatVersion: 2,
      },
      canCheckAgain: true,
      foreignHint: null,
    });
  });

  it("offers the foreign hint for a repository with other files", async () => {
    expect(await inspect(startCore(), "sample/foreign")).toMatchObject({
      kind: "unusable",
      error: { kind: "foreign" },
      foreignHint: FOREIGN_REPOSITORY_HINT,
    });
  });

  it("refuses to inspect a repository outside the last listing", async () => {
    const core = startCore();
    await call(core, "login.listRepositories", {
      forge: "github",
      accessToken: TOKEN,
    });
    const response = await send(core, "login.inspectRepository", {
      forge: "github",
      accessToken: "other-token",
      repositoryUrl: SAMPLE_URL,
    });
    expect(response).toMatchObject({ ok: false, error: { kind: "notReady" } });
  });

  it("refuses to unlock before a notes repo was inspected", async () => {
    const response = await send(startCore(), "login.unlock", {
      passphrase: "anything",
    });
    expect(response).toMatchObject({ ok: false, error: { kind: "notReady" } });
  });

  it("rejects a wrong passphrase", async () => {
    const core = startCore();
    await inspect(core, "sample/notes");
    const response = await send(core, "login.unlock", {
      passphrase: "not the passphrase",
    });
    expect(response).toMatchObject({
      ok: false,
      error: {
        kind: "wrongPassphrase",
        message: "Wrong passphrase.",
        transient: false,
      },
    });
    expect(await host.rememberedSession.load()).toBeNull();
  });

  it("unlocks a notes repo, remembers the session and reports progress", async () => {
    const core = startCore();
    await logIn(core);
    expect(await host.rememberedSession.load()).toMatchObject({
      repoUrl: SAMPLE_URL,
      coordinates: { forge: "github", owner: "sample", repo: "notes" },
    });
    expect(events("loadingProgress")).toContainEqual({
      step: "derivingKeys",
      message: "Deriving keys from your passphrase…",
    });
    expect(await call(core, "login.lastRepository")).toEqual({
      repoUrl: SAMPLE_URL,
      forge: "github",
    });
  });

  it("initialises an empty repository into a notes repo", async () => {
    const core = startCore();
    await inspect(core, "sample/empty");
    expect(
      await call(core, "login.initialize", {
        passphrase: "a new passphrase for notes",
      }),
    ).toEqual({
      kind: "loggedIn",
    });
    expect(events("loadingProgress")).toContainEqual({
      step: "initializing",
      message: "Setting up notes repo…",
    });
    expect(await inspect(core, "sample/empty")).toMatchObject({
      kind: "notesRepo",
    });
  });

  async function inspectWithSupersededEarlierCheck(
    core: NativeCoreHandle,
  ): Promise<void> {
    await call(core, "login.listRepositories", {
      forge: "github",
      accessToken: TOKEN,
    });
    const inspectParams = (repo: string) => ({
      forge: "github",
      accessToken: TOKEN,
      repositoryUrl: `https://github.com/${repo}`,
    });
    controls.hold("sample/empty", "inspect");
    try {
      const abandoned = send(
        core,
        "login.inspectRepository",
        inspectParams("sample/empty"),
      );
      await call(
        core,
        "login.inspectRepository",
        inspectParams("sample/notes"),
      );
      controls.release("sample/empty", "inspect");
      await abandoned;
    } finally {
      controls.release("sample/empty", "inspect");
    }
  }

  it("unlocks the most recently inspected repository when an earlier inspection finishes last", async () => {
    const core = startCore();
    await inspectWithSupersededEarlierCheck(core);
    expect(
      await call(core, "login.unlock", {
        passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
      }),
    ).toEqual({ kind: "loggedIn" });
    expect(await host.rememberedSession.load()).toMatchObject({
      repoUrl: SAMPLE_URL,
    });
  });

  it("refuses to initialise a repository whose inspection was superseded", async () => {
    const core = startCore();
    await inspectWithSupersededEarlierCheck(core);
    const response = await send(core, "login.initialize", {
      passphrase: "a new passphrase for notes",
    });
    expect(response).toMatchObject({ ok: false, error: { kind: "notReady" } });
    expect(await host.rememberedSession.load()).toBeNull();
  });

  it("rates passphrase strength", async () => {
    const core = startCore();
    expect(
      await call(core, "passphrase.strength", {
        passphrase: "notes",
        repositoryLabel: "sample/notes",
      }),
    ).toEqual({
      score: 0,
      label: "Weak",
      filledSegments: 1,
      weak: true,
      warning: expect.any(String),
    });
    expect(
      await call(core, "passphrase.strength", {
        passphrase: "violet tractor whispers under 41 frozen lanterns",
        repositoryLabel: "sample/notes",
      }),
    ).toMatchObject({
      score: 4,
      label: "Strong",
      filledSegments: 4,
      weak: false,
    });
  });
});

describe("session commands", () => {
  it("resumes nothing without a remembered session", async () => {
    expect(await call(startCore(), "session.resume")).toEqual({ kind: "none" });
  });

  it("resumes a remembered session in a new core over the same host", async () => {
    await logIn(startCore());
    cores[0].stop();
    expect(await call(startCore(), "session.resume")).toEqual({
      kind: "resumed",
    });
  });

  it("clears the remembered session when resuming fails for good", async () => {
    await logIn(startCore());
    cores[0].stop();
    await controls.changeRepoKey("sample/notes");
    const core = startCore();
    expect(await call(core, "session.resume")).toEqual({
      kind: "failed",
      error: {
        kind: "wrongPassphrase",
        message: "Wrong passphrase.",
        transient: false,
      },
      canRetry: false,
    });
    expect(await host.rememberedSession.load()).toBeNull();
    expect(await host.blobCache.listRepos()).toEqual([]);
  });

  it("logs out, clears the remembered session and the blob cache, and ends the session", async () => {
    const core = startCore();
    await logIn(core);
    expect(await host.blobCache.listRepos()).not.toEqual([]);
    expect(await call(core, "session.logout", { anyway: true })).toEqual({
      outcome: { kind: "loggedOut" },
    });
    expect(events("sessionEnded")).toEqual([{ reason: "loggedOut" }]);
    expect(await host.rememberedSession.load()).toBeNull();
    expect(await host.blobCache.listRepos()).toEqual([]);
    expect(await call(core, "session.resume")).toEqual({ kind: "none" });
  });

  it("logs out without a running app", async () => {
    expect(await call(startCore(), "session.logout", { anyway: true })).toEqual(
      { outcome: { kind: "loggedOut" } },
    );
    expect(events("sessionEnded")).toEqual([{ reason: "loggedOut" }]);
  });

  it("reports a passphrase changed on another device when the app becomes visible again", async () => {
    const core = startCore();
    await logIn(core);
    await controls.changeRepoKey("sample/notes");
    clock.advance(AUTO_REFRESH_THROTTLE_MS + 1_000);
    await call(core, "lifecycle.setVisible", { visible: false });
    await call(core, "lifecycle.setVisible", { visible: true });
    await vi.waitFor(() => expect(events("keyChanged")).toHaveLength(1));
    expect(events("keyChanged")).toEqual([
      {
        unsavedCount: 0,
        message: KEY_CHANGED_MESSAGE,
        detail: "All your changes were saved before this happened.",
        exportLabel: "Export notes",
      },
    ]);
  });

  it("validates lifecycle input", async () => {
    const core = startCore();
    expect(
      await send(core, "lifecycle.setOnline", { online: "yes" }),
    ).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
    expect(await call(core, "lifecycle.setOnline", { online: false })).toEqual(
      {},
    );
  });
});

describe("notes commands", () => {
  const WELCOME = sampleNotesRepoSource.find(
    (entry): entry is Extract<SampleEntry, { kind: "note" }> =>
      entry.kind === "note" && entry.name === "Welcome",
  )!;

  function lastRefreshNotice(): unknown {
    return events("notice").filter(
      (payload) => (payload as { id: string }).id === "refresh",
    );
  }

  it("routes every command to a handler", async () => {
    const core = startCore();
    for (const command of CORE_COMMAND_NAMES) {
      const response = await send(core, command, {});
      if (!response.ok) expect(response.error.kind).not.toBe("unknownCommand");
    }
  });

  it("refuses note commands without a running app", async () => {
    const core = startCore();
    for (const [command, params] of [
      ["tree.get", {}],
      ["note.open", { path: null }],
      ["sync.refresh", {}],
      ["note.edit", { path: ["Welcome"], text: "x" }],
      ["sync.retry", {}],
      ["conflict.resolve", { path: ["Welcome"], resolution: "keepMine" }],
      ["export.notes", {}],
      ["draft.start", { parent: [] }],
      ["folder.create", { parent: [], name: "x" }],
    ] as const) {
      expect(await send(core, command, params)).toMatchObject({
        ok: false,
        error: { kind: "notReady" },
      });
    }
  });

  it("returns the sample tree in display order with folder note counts", async () => {
    const core = startCore();
    await logIn(core);
    const { tree } = await call(core, "tree.get");
    expect(
      tree.map((node: { name: string; noteCount?: number }) => [
        node.name,
        node.noteCount,
      ]),
    ).toEqual([
      ["Empty folder", 0],
      ["Journal", 2],
      ["Projects", 2],
      ["Welcome", undefined],
      ["Zażółć gęślą jaźń", undefined],
    ]);
    expect(tree).toContainEqual({
      kind: "note",
      name: "Welcome",
      path: ["Welcome"],
    });
    const projects = tree.find(
      (node: { name: string }) => node.name === "Projects",
    );
    expect(projects).toMatchObject({
      kind: "folder",
      noteCount: 2,
      path: ["Projects"],
    });
    expect(projects.children[0]).toMatchObject({
      kind: "folder",
      name: "commitnote",
      noteCount: 2,
      path: ["Projects", "commitnote"],
    });
    expect(
      tree.find((node: { name: string }) => node.name === "Empty folder"),
    ).toMatchObject({
      noteCount: 0,
      children: [],
    });
    expect(events("treeChanged").at(-1)).toEqual({ tree });
  });

  it("opens a note with its exact text and reports it as changed", async () => {
    const core = startCore();
    await logIn(core);
    const loaded = {
      state: "loaded",
      path: ["Welcome"],
      content: WELCOME.markdown,
      conflict: null,
    };
    expect(await call(core, "note.open", { path: ["Welcome"] })).toEqual({
      note: loaded,
    });
    expect(events("noteChanged").at(-1)).toEqual({ note: loaded, edits: null });
    expect(await call(core, "note.open", { path: null })).toEqual({
      note: null,
    });
    expect(events("noteChanged").at(-1)).toEqual({ note: null, edits: null });
  });

  it("reports a note missing from the tree", async () => {
    const core = startCore();
    await logIn(core);
    expect(await call(core, "note.open", { path: ["Nope"] })).toEqual({
      note: {
        state: "missing",
        path: ["Nope"],
        message: "This note no longer exists.",
      },
    });
  });

  it("rejects a malformed note path", async () => {
    const core = startCore();
    await logIn(core);
    expect(await send(core, "note.open", { path: [1] })).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
  });

  it("emits a remote change after refreshing a note edited on another device", async () => {
    const core = startCore();
    await logIn(core);
    await call(core, "note.open", { path: ["Welcome"] });
    await controls.editNote("sample/notes", ["Welcome"], "Edited elsewhere");
    expect(await call(core, "sync.refresh")).toEqual({});
    expect(events("noteChanged").at(-1)).toEqual({
      note: {
        state: "loaded",
        path: ["Welcome"],
        content: "Edited elsewhere",
        conflict: null,
      },
      edits: [
        { from: 0, to: WELCOME.markdown.length, insert: "Edited elsewhere" },
      ],
    });
    expect(events("noteContentChangedRemotely")).toEqual([
      { change: "updated", message: "Updated on another device." },
    ]);
  });

  it("answers a failing refresh with an error and a refresh notice, cleared by a later success", async () => {
    const core = startCore();
    await logIn(core);
    controls.failNext("sample/notes", "getHead", "Server");
    expect(await send(core, "sync.refresh")).toMatchObject({
      ok: false,
      error: { kind: "server", transient: true },
    });
    expect(lastRefreshNotice()).toHaveLength(1);
    expect(lastRefreshNotice()).toMatchObject([
      { id: "refresh", tone: "error", persistent: true },
    ]);
    expect(await call(core, "sync.refresh")).toEqual({});
    expect(events("noticeCleared")).toEqual([{ id: "refresh" }]);
  });

  it("clears the refresh notice when dismissed", async () => {
    const core = startCore();
    await logIn(core);
    controls.failNext("sample/notes", "getHead", "Network");
    await send(core, "sync.refresh");
    expect(await call(core, "notices.dismiss", { id: "refresh" })).toEqual({});
    expect(events("noticeCleared")).toEqual([{ id: "refresh" }]);
    expect(await call(core, "notices.dismiss", { id: "refresh" })).toEqual({});
    expect(events("noticeCleared")).toHaveLength(1);
  });

  it("validates notice ids", async () => {
    const core = startCore();
    await logIn(core);
    expect(await send(core, "notices.dismiss", { id: "other" })).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
    expect(await call(core, "notices.dismiss", { id: "engine-999" })).toEqual(
      {},
    );
  });

  it("falls back to the device model for the device name", async () => {
    const core = startCore();
    expect(await call(core, "device.name")).toEqual({ name: "iPhone" });
  });

  it("reports connectivity changes without duplicates", async () => {
    const core = startCore();
    await logIn(core);
    await call(core, "lifecycle.setOnline", { online: false });
    await vi.waitFor(() =>
      expect(events("syncStateChanged").at(-1)).toMatchObject({
        online: false,
      }),
    );
    const count = events("syncStateChanged").length;
    await call(core, "lifecycle.setOnline", { online: false });
    expect(events("syncStateChanged")).toHaveLength(count);
    expect(events("syncStateChanged").at(-1)).toEqual({
      online: false,
      refreshing: false,
      treeLoaded: true,
      lastRefreshError: null,
      state: { kind: "synced" },
      label: "Synced",
      status: "Offline",
      unsavedCount: 0,
      canRetry: false,
      unsavedMenu: [{ id: "none", label: "No unsaved changes", path: null }],
    });
  });
});
