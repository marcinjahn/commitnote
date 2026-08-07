import { describe, expect, it } from "vitest";
import { REPO_CONFIG_PATH } from "../../format/v1";
import {
  createFakeForgeFactory,
  FAKE_FORGE_INVALID_TOKEN,
} from "./fake-forge-factory";

const TOKEN = "some-access-token";

function coordinatesFor(key: string): {
  forge: "github";
  owner: string;
  repo: string;
} {
  const [owner, repo] = key.split("/");
  return { forge: "github", owner, repo };
}

async function parsedConfig(repoConfigText: string | null): Promise<{
  formatVersion: number;
}> {
  if (repoConfigText === null) {
    throw new Error("expected a repo config text");
  }
  return JSON.parse(repoConfigText) as { formatVersion: number };
}

describe("createFakeForgeFactory", () => {
  it("sample/notes is populated and holds a format-1 repo config", async () => {
    const factory = await createFakeForgeFactory();
    const adapter = factory(coordinatesFor("sample/notes"), {
      accessToken: TOKEN,
    });

    const inspection = await adapter.inspect();
    if (inspection.kind !== "populated" || inspection.main === null) {
      throw new Error("expected a populated repo with a main head");
    }
    const config = await parsedConfig(inspection.main.repoConfigText);
    expect(config.formatVersion).toBe(1);
  });

  it("sample/empty is empty and writable, with initialization creating main", async () => {
    const factory = await createFakeForgeFactory();
    const adapter = factory(coordinatesFor("sample/empty"), {
      accessToken: TOKEN,
    });

    expect(await adapter.inspect()).toEqual({ kind: "empty", canWrite: true });

    const result = await adapter.initialize('{"formatVersion":1}', "init");
    expect(result.kind).toBe("ok");
    const head = result.kind === "ok" ? result.head : "";

    // "sample/empty" has a "master" default branch, distinct from "main";
    // inspect() reads main, so this only passes if initialize() also
    // created main.
    expect(await adapter.inspect()).toEqual({
      kind: "populated",
      canWrite: true,
      main: { head, repoConfigText: '{"formatVersion":1}' },
    });
  });

  it("sample/empty-read-only is empty and not writable", async () => {
    const factory = await createFakeForgeFactory();
    const adapter = factory(coordinatesFor("sample/empty-read-only"), {
      accessToken: TOKEN,
    });

    expect(await adapter.inspect()).toEqual({
      kind: "empty",
      canWrite: false,
    });
  });

  it("sample/read-only is populated and not writable", async () => {
    const factory = await createFakeForgeFactory();
    const adapter = factory(coordinatesFor("sample/read-only"), {
      accessToken: TOKEN,
    });

    const inspection = await adapter.inspect();
    if (inspection.kind !== "populated" || inspection.main === null) {
      throw new Error("expected a populated repo with a main head");
    }
    expect(inspection.canWrite).toBe(false);
    expect(inspection.main.repoConfigText).not.toBeNull();
  });

  it("sample/foreign is populated with no repo config and only README.md", async () => {
    const factory = await createFakeForgeFactory();
    const adapter = factory(coordinatesFor("sample/foreign"), {
      accessToken: TOKEN,
    });

    const inspection = await adapter.inspect();
    if (inspection.kind !== "populated" || inspection.main === null) {
      throw new Error("expected a populated repo with a main head");
    }
    expect(inspection.main.repoConfigText).toBeNull();

    const entries = await adapter.listTree(inspection.main.head);
    const files = entries.filter((entry) => entry.type === "blob");
    expect(files.map((entry) => entry.path)).toEqual(["README.md"]);
  });

  it("sample/newer is populated with a repo config at a newer format version", async () => {
    const factory = await createFakeForgeFactory();
    const adapter = factory(coordinatesFor("sample/newer"), {
      accessToken: TOKEN,
    });

    const inspection = await adapter.inspect();
    if (inspection.kind !== "populated" || inspection.main === null) {
      throw new Error("expected a populated repo with a main head");
    }
    const config = await parsedConfig(inspection.main.repoConfigText);
    expect(config.formatVersion).toBe(2);

    const entries = await adapter.listTree(inspection.main.head);
    const files = entries.filter((entry) => entry.type === "blob");
    expect(files.map((entry) => entry.path)).toEqual([REPO_CONFIG_PATH]);
  });

  it("returns the same adapter instance for the same fixture across calls", async () => {
    const factory = await createFakeForgeFactory();
    const first = factory(coordinatesFor("sample/notes"), {
      accessToken: TOKEN,
    });
    const second = factory(coordinatesFor("sample/notes"), {
      accessToken: TOKEN,
    });

    expect(first).toBe(second);
  });

  it("looks fixtures up case-insensitively", async () => {
    const factory = await createFakeForgeFactory();
    const lower = factory(coordinatesFor("sample/notes"), {
      accessToken: TOKEN,
    });
    const upper = factory(
      { forge: "github", owner: "SAMPLE", repo: "NOTES" },
      { accessToken: TOKEN },
    );

    expect(lower).toBe(upper);
  });

  it("rejects every operation with Unauthorized when the token is the invalid-token sentinel", async () => {
    const factory = await createFakeForgeFactory();
    const adapter = factory(coordinatesFor("sample/notes"), {
      accessToken: FAKE_FORGE_INVALID_TOKEN,
    });

    await expect(adapter.inspect()).rejects.toMatchObject({
      kind: "Unauthorized",
    });
    await expect(adapter.getHead()).rejects.toMatchObject({
      kind: "Unauthorized",
    });
  });

  it("rejects every operation with NotFound for an unknown fixture repository", async () => {
    const factory = await createFakeForgeFactory();
    const adapter = factory(coordinatesFor("sample/unknown"), {
      accessToken: TOKEN,
    });

    await expect(adapter.inspect()).rejects.toMatchObject({
      kind: "NotFound",
    });
    await expect(adapter.getHead()).rejects.toMatchObject({
      kind: "NotFound",
    });
  });
});
