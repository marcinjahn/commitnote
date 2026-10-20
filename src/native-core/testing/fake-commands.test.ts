import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    shareStorage: new Map<string, string>() as unknown as Storage,
  });
  controls = forge.controls;
  const core = createNativeCore({
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
  return { core, send };
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
});
