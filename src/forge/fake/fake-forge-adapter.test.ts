import { describe, expect, it } from "vitest";
import { REPO_CONFIG_PATH } from "../../format/v1";
import { ForgeError } from "../errors";
import type { ContentCreatingRequest } from "../forge-adapter";
import { FakeForgeAdapter } from "./fake-forge-adapter";

describe("FakeForgeAdapter.inspect", () => {
  it("reports empty for a repo with no commits", async () => {
    const adapter = new FakeForgeAdapter();
    expect(await adapter.inspect()).toEqual({ kind: "empty", canWrite: true });
  });

  it("reports populated with the config text once initialized", async () => {
    const adapter = new FakeForgeAdapter();
    const result = await adapter.initialize('{"x":1}', "init");
    expect(result.kind).toBe("ok");
    const head = result.kind === "ok" ? result.head : "";

    expect(await adapter.inspect()).toEqual({
      kind: "populated",
      canWrite: true,
      main: { head, repoConfigText: '{"x":1}' },
    });
  });
});

describe("FakeForgeAdapter.initialize", () => {
  it("becomes stale once a first commit already exists", async () => {
    const adapter = new FakeForgeAdapter();
    await adapter.initialize("{}", "init");
    expect(await adapter.initialize("{}", "init again")).toEqual({
      kind: "stale",
    });
  });

  it("reports initialize and createRef and leaves both branches at the head when the default branch differs from main", async () => {
    const requests: ContentCreatingRequest[] = [];
    const adapter = new FakeForgeAdapter({
      defaultBranch: "master",
      onContentCreatingRequest: (request) => requests.push(request),
    });

    const result = await adapter.initialize("{}", "init");
    expect(result.kind).toBe("ok");
    const head = result.kind === "ok" ? result.head : "";

    expect(requests.map((request) => request.operation)).toEqual([
      "initialize",
      "createRef",
    ]);
    expect(adapter.repo.getRef("master")).toBe(head);
    expect(adapter.repo.getRef("main")).toBe(head);
  });
});

describe("FakeForgeAdapter.commit", () => {
  async function initializedAdapter(): Promise<{
    adapter: FakeForgeAdapter;
    head: string;
  }> {
    const adapter = new FakeForgeAdapter();
    const result = await adapter.initialize("{}", "init");
    if (result.kind !== "ok") {
      throw new Error("expected ok");
    }
    return { adapter, head: result.head };
  }

  it("commits changes and advances main", async () => {
    const { adapter, head } = await initializedAdapter();
    const result = await adapter.commit({
      parent: head,
      changes: [{ kind: "upsert-text", path: "note.md", text: "hello" }],
      message: "save",
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(await adapter.getHead()).toBe(result.head);
      expect(await adapter.readBlob(await adapter.repo.putBlob("hello"))).toBe(
        "hello",
      );
    }
  });

  it("reports createTree, createCommit, updateRef", async () => {
    const requests: ContentCreatingRequest[] = [];
    const { adapter, head } = await initializedAdapter();
    const existingBlobSha = await adapter.repo.putBlob("reused");

    const adapterWithReporting = new FakeForgeAdapter({
      repo: adapter.repo,
      onContentCreatingRequest: (request) => requests.push(request),
    });

    await adapterWithReporting.commit({
      parent: head,
      changes: [
        { kind: "upsert-text", path: "a.md", text: "one" },
        { kind: "upsert-text", path: "b.md", text: "two" },
        { kind: "upsert-blob", path: "c.md", blobSha: existingBlobSha },
      ],
      message: "save",
    });

    expect(requests.map((request) => request.operation)).toEqual([
      "createTree",
      "createCommit",
      "updateRef",
    ]);
  });

  it("still reports every content-creating request when the ref update is stale", async () => {
    const requests: ContentCreatingRequest[] = [];
    const { adapter, head } = await initializedAdapter();
    const reportingAdapter = new FakeForgeAdapter({
      repo: adapter.repo,
      onContentCreatingRequest: (request) => requests.push(request),
    });

    await reportingAdapter.pushFromAnotherDevice([
      {
        kind: "upsert-text",
        path: "elsewhere.md",
        text: "from another device",
      },
    ]);

    const result = await reportingAdapter.commit({
      parent: head,
      changes: [{ kind: "upsert-text", path: "mine.md", text: "mine" }],
      message: "save",
    });

    expect(result).toEqual({ kind: "stale" });
    expect(requests.map((request) => request.operation)).toEqual([
      "createTree",
      "createCommit",
      "updateRef",
    ]);
  });

  it("becomes stale when pushFromAnotherDevice moved main past the commit's parent", async () => {
    const { adapter, head } = await initializedAdapter();
    await adapter.pushFromAnotherDevice([
      { kind: "upsert-text", path: "other.md", text: "other device" },
    ]);

    const result = await adapter.commit({
      parent: head,
      changes: [{ kind: "upsert-text", path: "mine.md", text: "mine" }],
      message: "save",
    });
    expect(result).toEqual({ kind: "stale" });
  });
});

describe("FakeForgeAdapter read-only mode", () => {
  it("rejects writes with Forbidden before any effect, but allows reads", async () => {
    const writableAdapter = new FakeForgeAdapter();
    const initResult = await writableAdapter.initialize("{}", "init");
    if (initResult.kind !== "ok") {
      throw new Error("expected ok");
    }

    const readOnlyAdapter = new FakeForgeAdapter({
      repo: writableAdapter.repo,
      canWrite: false,
    });

    await expect(
      readOnlyAdapter.initialize("{}", "again"),
    ).rejects.toMatchObject({
      kind: "Forbidden",
    });
    await expect(
      readOnlyAdapter.commit({
        parent: initResult.head,
        changes: [{ kind: "upsert-text", path: "note.md", text: "x" }],
        message: "save",
      }),
    ).rejects.toMatchObject({ kind: "Forbidden" });

    expect(await readOnlyAdapter.inspect()).toMatchObject({
      kind: "populated",
      canWrite: false,
    });
    expect(await readOnlyAdapter.getHead()).toBe(initResult.head);
  });
});

describe("FakeForgeAdapter.failNext", () => {
  it("queues one-shot failures per operation in FIFO order", async () => {
    const adapter = new FakeForgeAdapter();
    const first = new ForgeError("Network");
    const second = new ForgeError("Server");
    adapter.failNext("inspect", first);
    adapter.failNext("inspect", second);

    await expect(adapter.inspect()).rejects.toBe(first);
    await expect(adapter.inspect()).rejects.toBe(second);
    expect(await adapter.inspect()).toEqual({ kind: "empty", canWrite: true });
  });

  it("rejects a commit before any effect when a ForgeError is queued", async () => {
    const adapter = new FakeForgeAdapter();
    const initResult = await adapter.initialize("{}", "init");
    if (initResult.kind !== "ok") {
      throw new Error("expected ok");
    }

    const error = new ForgeError("RateLimited");
    adapter.failNext("commit", error);

    await expect(
      adapter.commit({
        parent: initResult.head,
        changes: [{ kind: "upsert-text", path: "note.md", text: "x" }],
        message: "save",
      }),
    ).rejects.toBe(error);

    expect(await adapter.getHead()).toBe(initResult.head);
  });

  it("returns stale for a queued 'stale' commit failure without changing anything", async () => {
    const adapter = new FakeForgeAdapter();
    const initResult = await adapter.initialize("{}", "init");
    if (initResult.kind !== "ok") {
      throw new Error("expected ok");
    }

    adapter.failNext("commit", "stale");
    const result = await adapter.commit({
      parent: initResult.head,
      changes: [{ kind: "upsert-text", path: "note.md", text: "x" }],
      message: "save",
    });

    expect(result).toEqual({ kind: "stale" });
    expect(await adapter.getHead()).toBe(initResult.head);
  });

  it("rejects 'stale' for operations that do not support it", () => {
    const adapter = new FakeForgeAdapter();
    expect(() => adapter.failNext("getHead", "stale")).toThrow();
  });
});

describe("FakeForgeAdapter.readBlob", () => {
  it("caches blob text and serves a cache hit before consulting queued failures", async () => {
    const adapter = new FakeForgeAdapter();
    const initResult = await adapter.initialize("{}", "init");
    if (initResult.kind !== "ok") {
      throw new Error("expected ok");
    }
    const configSha = adapter.repo
      .getTree(adapter.repo.getCommit(initResult.head)?.tree ?? "")
      ?.get(REPO_CONFIG_PATH);
    if (configSha === undefined) {
      throw new Error("expected config blob");
    }

    expect(await adapter.readBlob(configSha)).toBe("{}");

    adapter.failNext("readBlob", new ForgeError("Network"));
    expect(await adapter.readBlob(configSha)).toBe("{}");

    await expect(adapter.readBlob("unknown-sha")).rejects.toMatchObject({
      kind: "Network",
    });
  });
});
