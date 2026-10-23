import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sniffImageFormat } from "../../images/pipeline/image-format";
import { sharedMemoizedArgon2id } from "../../crypto/testing/shared-argon2id";
import {
  createFakeForge,
  type FakeForgeControls,
} from "../../testing/fake-forge/fake-forge-factory";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../../testing/sample-notes-repo/sample-source";
import { FAKE_CORE_COMMAND_NAMES, type CoreResponse } from "../api";
import { createNativeCore } from "../native-core";
import { createCryptoShim } from "../runtime/crypto-shim";
import { createFakeCommands } from "./fake-commands";
import { TEST_VECTOR_FILES } from "./check-vectors";
import {
  createNodeHostServices,
  type NodeHostServices,
} from "./node-host-services";

function pngBytes(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(25);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 13);
  ihdr.set([0x49, 0x48, 0x44, 0x52], 4);
  view.setUint32(8, width);
  view.setUint32(12, height);
  ihdr.set([8, 2, 0, 0, 0], 16);
  return Uint8Array.of(
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...ihdr,
  );
}

let host: NodeHostServices;
let controls: FakeForgeControls;
let requests: { url: string; method: string | undefined }[];

beforeAll(() => {
  const shim = createCryptoShim(() => host);
  vi.stubGlobal("crypto", shim.crypto);
  vi.stubGlobal("CryptoKey", shim.CryptoKey);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

async function setUp() {
  requests = [];
  const base = createNodeHostServices({
    fetch: (async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method });
      return new Response("pong", {
        status: 201,
        headers: { "X-Reply": "Yes" },
      });
    }) as unknown as typeof fetch,
  });
  host = {
    ...base,
    crypto: {
      ...base.crypto,
      argon2id: (input) => sharedMemoizedArgon2id(input),
    },
  };
  const forge = await createFakeForge({
    argon2id: sharedMemoizedArgon2id,
  });
  controls = forge.controls;
  const start = () =>
    createNativeCore({
      host,
      deviceModel: "iPhone",
      registry: () => Promise.resolve(forge.registry),
      extraCommands: (app) =>
        createFakeCommands({
          getApp: () => app,
          controls: () => Promise.resolve(forge.controls),
          host,
        }),
    });
  let core = start();
  const restart = () => {
    core.stop();
    core = start();
  };
  let nextId = 1;
  async function send(
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<CoreResponse> {
    const id = nextId++;
    core.send(JSON.stringify({ id, command, params }));
    return vi.waitFor(
      () => {
        const response = host.posted
          .map((message) => JSON.parse(message) as CoreResponse)
          .find((message) => message.kind === "response" && message.id === id);
        if (response === undefined) throw new Error("No response yet");
        return response;
      },
      { timeout: 20_000, interval: 2 },
    );
  }
  function events(name: string): any[] {
    return host.posted
      .map((message) => JSON.parse(message))
      .filter((message) => message.kind === "event" && message.event === name)
      .map((message) => message.payload);
  }
  async function openSampleSession() {
    await ok(
      send("login.listRepositories", { forge: "github", accessToken: "t" }),
    );
    await ok(
      send("login.inspectRepository", {
        forge: "github",
        accessToken: "t",
        repositoryUrl: "https://github.com/sample/notes",
      }),
    );
    await ok(
      send("login.unlock", { passphrase: SAMPLE_NOTES_REPO_PASSPHRASE }),
    );
  }
  async function openLoaded(path: string[]) {
    return vi.waitFor(
      async () => {
        const { note } = await ok(send("note.open", { path }));
        if (note?.state !== "loaded") throw new Error("not loaded yet");
        return note;
      },
      { timeout: 20_000, interval: 20 },
    );
  }
  return {
    get core() {
      return core;
    },
    restart,
    send,
    events,
    openSampleSession,
    openLoaded,
  };
}

async function ok(response: Promise<CoreResponse>): Promise<any> {
  const resolved = await response;
  if (!resolved.ok) throw new Error(`failed: ${resolved.error.kind}`);
  return resolved.result;
}

describe("fake core commands", () => {
  it("registers every fake-only command", async () => {
    const { core, send } = await setUp();
    for (const command of FAKE_CORE_COMMAND_NAMES) {
      const response = await send(command, {});
      if (!response.ok) expect(response.error.kind).not.toBe("unknownCommand");
    }
    core.stop();
  });

  it("saves a note through the running engine and refuses without a session", async () => {
    const { core, send } = await setUp();
    expect(
      await send("fake.saveNote", { path: ["Welcome"], text: "x" }),
    ).toMatchObject({ ok: false, error: { kind: "notReady" } });

    await ok(
      send("login.listRepositories", { forge: "github", accessToken: "t" }),
    );
    await ok(
      send("login.inspectRepository", {
        forge: "github",
        accessToken: "t",
        repositoryUrl: "https://github.com/sample/notes",
      }),
    );
    await ok(
      send("login.unlock", { passphrase: SAMPLE_NOTES_REPO_PASSPHRASE }),
    );
    const before = controls.commitMessages("sample/notes").length;

    expect(
      await ok(send("fake.saveNote", { path: ["Welcome"], text: "Saved" })),
    ).toEqual({});

    expect(controls.commitMessages("sample/notes")).toHaveLength(before + 1);
    expect(
      await send("fake.saveNote", { path: "Welcome", text: "x" }),
    ).toMatchObject({ ok: false, error: { kind: "invalidParams" } });
    core.stop();
  });

  it("exports a fixture repo and rejects an unknown one", async () => {
    const { core, send } = await setUp();
    const { exported } = await ok(
      send("fake.exportRepo", { repoKey: "sample/notes" }),
    );
    expect(exported).toBe(controls.exportRepo("sample/notes"));
    expect(
      await send("fake.exportRepo", { repoKey: "nobody/nothing" }),
    ).toMatchObject({ ok: false, error: { kind: "invalidParams" } });
    core.stop();
  });

  it("lists every sample note with its exact text", async () => {
    const { core, send } = await setUp();
    const { notes } = await ok(send("fake.expectedSampleNotes"));
    expect(notes.map((note: { path: string[] }) => note.path)).toEqual([
      ["Welcome"],
      ["Projects", "commitnote", "Ideas"],
      ["Projects", "commitnote", "Roadmap"],
      ["Journal", "2026", "January"],
      ["Zażółć gęślą jaźń"],
      ["Journal", "2026", "Whiteboard"],
    ]);
    expect(notes[0].text.startsWith("# Welcome\n")).toBe(true);
    expect(notes[5].text).toContain("Sketch from the planning session.");
    core.stop();
  });

  it("reports every vector file as failing when none is supplied", async () => {
    const { core, send } = await setUp();
    const result = await ok(send("fake.checkVectors", { files: {} }));
    expect(result.failures.slice(0, TEST_VECTOR_FILES.length)).toEqual(
      TEST_VECTOR_FILES.map((file) => `${file}: format`),
    );
    expect(result.checked).toBe(result.failures.length);
    core.stop();
  });

  it("performs an HTTP request through the host with lower-cased header names", async () => {
    const { core, send } = await setUp();
    const result = await ok(
      send("fake.httpRequest", {
        method: "post",
        url: "https://example.test/ping",
        headers: { "X-Token": "a" },
        bodyText: "body",
      }),
    );
    expect(result).toEqual({
      status: 201,
      headers: { "x-reply": "Yes", "content-type": "text/plain;charset=UTF-8" },
      bodyText: "pong",
    });
    expect(requests).toEqual([
      { url: "https://example.test/ping", method: "POST" },
    ]);
    core.stop();
  });

  it("processes an image through the host image codec", async () => {
    const { core, send } = await setUp();
    const png = pngBytes(3000, 1500);
    const processed = await ok(
      send("fake.processImage", {
        base64: Buffer.from(png).toString("base64"),
        type: "image/png",
        profile: "note",
      }),
    );
    expect(processed.result).toMatchObject({
      ok: true,
      type: "image/webp",
      width: 2560,
      height: 1280,
    });
    expect(
      sniffImageFormat(Buffer.from(processed.result.base64, "base64")),
    ).toBe("webp");

    expect(
      await ok(
        send("fake.processImage", {
          base64: Buffer.from("not an image").toString("base64"),
          type: "image/png",
          profile: "share",
        }),
      ),
    ).toEqual({ result: { ok: false, rejection: "unsupported" } });
    expect(
      await send("fake.processImage", {
        base64: "",
        type: "",
        profile: "other",
      }),
    ).toMatchObject({ ok: false, error: { kind: "invalidParams" } });
    core.stop();
  });

  it("fires timers in delay order and skips the cancelled one", async () => {
    const { core, send } = await setUp();
    expect(
      await ok(
        send("fake.timerProbe", { delaysMs: [30, 5, 15, 1], cancelIndex: 2 }),
      ),
    ).toEqual({ fired: [3, 1, 0] });
    expect(
      await ok(send("fake.timerProbe", { delaysMs: [], cancelIndex: null })),
    ).toEqual({ fired: [] });
    core.stop();
  });

  it("reaches a conflict with a remote edit of the same line", async () => {
    const { core, send, events, openSampleSession, openLoaded } = await setUp();
    await openSampleSession();
    const note = await openLoaded(["Welcome"]);
    const lines = note.content.split("\n");

    await ok(
      send("fake.remoteEdit", {
        repo: "sample/notes",
        path: ["Welcome"],
        text: ["# Remote title", ...lines.slice(1)].join("\n"),
        device: "Other iPhone",
      }),
    );
    await ok(
      send("note.edit", {
        path: ["Welcome"],
        text: ["# Local title", ...lines.slice(1)].join("\n"),
      }),
    );
    await ok(send("sync.flush"));

    await vi.waitFor(() => {
      const latest = events("noteChanged").at(-1)?.note;
      expect(latest?.conflict).toMatchObject({ otherDevice: "Other iPhone" });
    });
    expect(
      events("notice").some(
        (notice) =>
          notice.action?.kind === "openNote" &&
          notice.action.path.join() === "Welcome",
      ),
    ).toBe(true);
    core.stop();
  });

  it("fails saves until the failures are cleared, then saves on retry", async () => {
    const { core, send, events, openSampleSession, openLoaded } = await setUp();
    await openSampleSession();
    await openLoaded(["Welcome"]);
    const before = controls.commitMessages("sample/notes").length;

    await ok(
      send("fake.failNext", {
        repo: "sample/notes",
        operation: "commit",
        kind: "Network",
        count: 50,
      }),
    );
    await ok(send("note.edit", { path: ["Welcome"], text: "Edited offline" }));
    expect(await ok(send("sync.flush"))).toEqual({
      result: { kind: "unsaved", count: 1 },
    });
    await vi.waitFor(() => {
      const latest = events("syncStateChanged").at(-1);
      expect(latest).toMatchObject({
        canRetry: true,
        state: { kind: "out-of-sync", reason: "failed" },
      });
    });

    await ok(send("sync.retry"));
    await vi.waitFor(() => {
      expect(events("syncStateChanged").length).toBeGreaterThan(0);
    });
    expect(await ok(send("sync.flush"))).toMatchObject({
      result: { kind: "unsaved" },
    });
    expect(controls.commitMessages("sample/notes")).toHaveLength(before);

    await ok(
      send("fake.clearFailures", { repo: "sample/notes", operation: "commit" }),
    );
    await ok(send("sync.retry"));
    await vi.waitFor(() => {
      expect(controls.commitMessages("sample/notes")).toHaveLength(before + 1);
    });
    expect(await ok(send("sync.flush"))).toEqual({
      result: { kind: "saved" },
    });
    core.stop();
  });

  it("reports a changed key with the unsaved edit and exports it", async () => {
    const { core, send, events, openSampleSession, openLoaded } = await setUp();
    await openSampleSession();
    await openLoaded(["Welcome"]);

    await ok(send("fake.changeRepoKey", { repo: "sample/notes" }));
    await ok(send("note.edit", { path: ["Welcome"], text: "Unsaved words" }));
    await ok(send("sync.flush"));

    await vi.waitFor(() => {
      expect(events("keyChanged").at(-1)).toMatchObject({ unsavedCount: 1 });
    });
    expect(events("keyChanged").at(-1).exportLabel).toBe(
      "Export unsaved notes",
    );
    const archive = await ok(send("export.notes"));
    expect(archive.mimeType).toBe("application/zip");
    const files = unzipSync(new Uint8Array(Buffer.from(archive.base64, "base64")));
    expect(strFromU8(files["Welcome.md"]!)).toBe("Unsaved words");
    core.stop();
  });

  it("shares a saved note and refuses a missing one", async () => {
    const { core, send, events, openSampleSession } = await setUp();
    await openSampleSession();
    await vi.waitFor(() => {
      expect(events("treeChanged").at(-1)?.tree).not.toBeNull();
    });

    expect(await ok(send("fake.shareNote", { path: ["Welcome"] }))).toEqual({});
    await vi.waitFor(() => {
      const welcome = events("treeChanged")
        .at(-1)
        .tree.find((node: { name: string }) => node.name === "Welcome");
      expect(welcome.shared).toBe(true);
    });
    expect(
      await send("fake.shareNote", { path: ["Nothing here"] }),
    ).toMatchObject({ ok: false, error: { kind: "invalidParams" } });
    core.stop();
  });

  it("keeps a remembered-session resume pending until loading is released", async () => {
    const ctx = await setUp();
    await ctx.openSampleSession();
    ctx.restart();

    await ok(ctx.send("fake.holdLoading"));
    await ok(ctx.send("fake.holdLoading"));
    let settled: CoreResponse | null = null;
    const resumed = ctx.send("session.resume").then((response) => {
      settled = response;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(settled).toBeNull();

    await ok(ctx.send("fake.releaseLoading"));
    expect(await resumed).toMatchObject({
      ok: true,
      result: { kind: "resumed" },
    });
    ctx.core.stop();
  });
});
