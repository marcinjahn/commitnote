import { describe, expect, it } from "vitest";
import { sharedMemoizedArgon2id } from "../../crypto/testing/shared-argon2id";
import { sampleNotesRepoKeyring } from "../sample-notes-repo/sample-notes-repo-keyring";
import { encryptPath } from "../../crypto/name-cipher";
import { decryptNote } from "../../crypto/note-cipher";
import { REPO_CONFIG_PATH } from "../../format/v1";
import {
  createFakeForge,
  FAKE_FORGE_INVALID_TOKEN,
  FAKE_FORGE_NO_REPOSITORIES_TOKEN,
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

describe("createFakeForge", () => {
  it("sample/notes is populated and holds a format-1 repo config", async () => {
    const factory = (await createFakeForge()).factory;
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
    const factory = (await createFakeForge()).factory;
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
      main: { head, repoConfigText: '{"formatVersion":1}', rootEntries: null },
    });
  });

  it("sample/empty-read-only is empty and not writable", async () => {
    const factory = (await createFakeForge()).factory;
    const adapter = factory(coordinatesFor("sample/empty-read-only"), {
      accessToken: TOKEN,
    });

    expect(await adapter.inspect()).toEqual({
      kind: "empty",
      canWrite: false,
    });
  });

  it("sample/read-only is populated and not writable", async () => {
    const factory = (await createFakeForge()).factory;
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

  it("sample/search is populated, writable and holds a repo config", async () => {
    const factory = (await createFakeForge()).factory;
    const adapter = factory(coordinatesFor("sample/search"), {
      accessToken: TOKEN,
    });

    const inspection = await adapter.inspect();
    if (inspection.kind !== "populated" || inspection.main === null) {
      throw new Error("expected a populated repo with a main head");
    }
    expect(inspection.canWrite).toBe(true);
    expect(inspection.main.repoConfigText).not.toBeNull();
  });

  it("sample/foreign is populated with no repo config, a README and code", async () => {
    const factory = (await createFakeForge()).factory;
    const adapter = factory(coordinatesFor("sample/foreign"), {
      accessToken: TOKEN,
    });

    const inspection = await adapter.inspect();
    if (inspection.kind !== "populated" || inspection.main === null) {
      throw new Error("expected a populated repo with a main head");
    }
    expect(inspection.main.repoConfigText).toBeNull();
    expect(inspection.main.rootEntries).toEqual([
      { name: "README.md", type: "blob" },
      { name: "index.js", type: "blob" },
    ]);
  });

  it("sample/almost-empty has only a README, a licence and a .gitignore", async () => {
    const factory = (await createFakeForge()).factory;
    const adapter = factory(coordinatesFor("sample/almost-empty"), {
      accessToken: TOKEN,
    });

    const inspection = await adapter.inspect();
    if (inspection.kind !== "populated" || inspection.main === null) {
      throw new Error("expected a populated repo with a main head");
    }
    expect(inspection.canWrite).toBe(true);
    expect(inspection.main.repoConfigText).toBeNull();
    expect(inspection.main.rootEntries).toEqual([
      { name: ".gitignore", type: "blob" },
      { name: "LICENSE", type: "blob" },
      { name: "README.md", type: "blob" },
    ]);
  });

  it("sample/public-empty is empty and writable", async () => {
    const factory = (await createFakeForge()).factory;
    const adapter = factory(coordinatesFor("sample/public-empty"), {
      accessToken: TOKEN,
    });

    expect(await adapter.inspect()).toEqual({ kind: "empty", canWrite: true });
  });

  it("sample/newer is populated with a repo config at a newer format version", async () => {
    const factory = (await createFakeForge()).factory;
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
    const factory = (await createFakeForge()).factory;
    const first = factory(coordinatesFor("sample/notes"), {
      accessToken: TOKEN,
    });
    const second = factory(coordinatesFor("sample/notes"), {
      accessToken: TOKEN,
    });

    expect(first).toBe(second);
  });

  it("looks fixtures up case-insensitively", async () => {
    const factory = (await createFakeForge()).factory;
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
    const factory = (await createFakeForge()).factory;
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
    const factory = (await createFakeForge()).factory;
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

describe("createFakeForge controls", () => {
  it("editNote moves main and the change is visible through the factory", async () => {
    const { factory, controls } = await createFakeForge({
      argon2id: sharedMemoizedArgon2id,
    });
    const adapter = factory(coordinatesFor("sample/notes"), {
      accessToken: TOKEN,
    });

    const before = await adapter.inspect();
    if (before.kind !== "populated" || before.main === null) {
      throw new Error("expected a populated repo with a main head");
    }

    await controls.editNote("sample/notes", ["Welcome"], "# Changed\n");

    const after = await adapter.inspect();
    if (
      after.kind !== "populated" ||
      after.main === null ||
      after.main.repoConfigText === null
    ) {
      throw new Error("expected a populated repo with a main head");
    }
    expect(after.main.head).not.toBe(before.main.head);

    const keyring = await sampleNotesRepoKeyring();
    const storedWelcomePath = await encryptPath(keyring, ["Welcome"]);

    const entries = await adapter.listTree(after.main.head);
    const welcome = entries.find((entry) => entry.path === storedWelcomePath);
    if (welcome === undefined) {
      throw new Error("expected the Welcome note to still exist");
    }
    const storedText = await adapter.readBlob(welcome.sha);
    expect(await decryptNote(keyring, storedText)).toBe("# Changed\n");
  });

  it("failNext makes the next commit reject with the given ForgeError kind", async () => {
    const { factory, controls } = await createFakeForge();
    const adapter = factory(coordinatesFor("sample/notes"), {
      accessToken: TOKEN,
    });

    controls.failNext("sample/notes", "commit", "Unauthorized");

    const head = await adapter.getHead();
    await expect(
      adapter.commit({ parent: head, changes: [], message: "test" }),
    ).rejects.toMatchObject({ kind: "Unauthorized" });
  });

  it("adoptRepo moves a fixture to the state exported from another fake forge", async () => {
    const first = await createFakeForge();
    const second = await createFakeForge();
    const source = first.factory(coordinatesFor("sample/notes"), {
      accessToken: TOKEN,
    });
    const target = second.factory(coordinatesFor("sample/notes"), {
      accessToken: TOKEN,
    });
    const head = await source.getHead();
    const result = await source.commit({
      parent: head,
      changes: [{ kind: "upsert-text", path: "extra.txt", text: "extra" }],
      message: "test",
    });
    if (result.kind !== "ok") throw new Error("expected a commit");

    second.controls.adoptRepo(
      "sample/notes",
      first.controls.exportRepo("sample/notes"),
    );

    expect(await target.getHead()).toBe(result.head);
    const listing = await target.listTree(result.head);
    const entry = listing.find((item) => item.path === "extra.txt");
    expect(await target.readBlob(entry!.sha)).toBe("extra");
  });

  it("editNote throws for an unknown fixture repository", async () => {
    const { controls } = await createFakeForge();

    await expect(
      controls.editNote("sample/unknown", ["Note"], "# Note\n"),
    ).rejects.toThrow();
  });

  it("failNext throws for an unknown fixture repository", async () => {
    const { controls } = await createFakeForge();

    expect(() =>
      controls.failNext("sample/unknown", "commit", "Unauthorized"),
    ).toThrow();
  });
});

describe("createFakeForge registry", () => {
  it("lists every fixture repository as a GitHub repository", async () => {
    const { registry } = await createFakeForge({ argon2id: sharedMemoizedArgon2id });

    const repositories = await registry.github.listRepositories(TOKEN);

    expect(repositories.map((r) => r.url)).toEqual([
      "https://github.com/sample/notes",
      "https://github.com/sample/empty",
      "https://github.com/sample/empty-read-only",
      "https://github.com/sample/read-only",
      "https://github.com/sample/foreign",
      "https://github.com/sample/newer",
      "https://github.com/sample/search",
      "https://github.com/sample/trash",
      "https://github.com/sample/almost-empty",
      "https://github.com/sample/public-empty",
    ]);
    expect(repositories[0].coordinates).toEqual(coordinatesFor("sample/notes"));
    expect(
      repositories.filter((r) => !r.private).map((r) => r.coordinates.repo),
    ).toEqual(["public-empty"]);
  });

  it("links the GitHub provider to creating a private repository", async () => {
    const { registry } = await createFakeForge({ argon2id: sharedMemoizedArgon2id });

    expect(registry.github.repositoryCreationUrl()).toBe(
      "https://github.com/new?name=notes&visibility=private",
    );
  });

  it("rejects the invalid token when listing", async () => {
    const { registry } = await createFakeForge({ argon2id: sharedMemoizedArgon2id });

    await expect(
      registry.github.listRepositories(FAKE_FORGE_INVALID_TOKEN),
    ).rejects.toMatchObject({ kind: "Unauthorized" });
  });

  it("lists no repositories for the no-repositories token", async () => {
    const { registry } = await createFakeForge({ argon2id: sharedMemoizedArgon2id });

    expect(
      await registry.github.listRepositories(FAKE_FORGE_NO_REPOSITORIES_TOKEN),
    ).toEqual([]);
  });

  it("creates fixture adapters through the registry", async () => {
    const { registry } = await createFakeForge({ argon2id: sharedMemoizedArgon2id });

    const adapter = registry.github.createAdapter(
      coordinatesFor("sample/empty"),
      { accessToken: TOKEN },
    );

    expect(await adapter.inspect()).toEqual({ kind: "empty", canWrite: true });
  });
});

describe("createFakeForge registry", () => {
  it("exposes a second provider with its own repositories", async () => {
    const { registry } = await createFakeForge();
    const providers = Object.values(registry);

    expect(providers.map((p) => p.name)).toEqual(["GitHub", "Fakelab"]);
    const second = providers[1];
    const repositories = await second.listRepositories(TOKEN);
    expect(repositories.map((r) => r.url)).toEqual([
      "https://fakelab.test/team/notes",
      "https://fakelab.test/team/empty",
    ]);
    expect(repositories.every((r) => r.private)).toBe(true);
    expect(second.repositoryCreationUrl()).toBe(
      "https://fakelab.test/projects/new",
    );
    expect(repositories.every((r) => r.coordinates.forge === second.id)).toBe(
      true,
    );
    await expect(
      second.listRepositories(FAKE_FORGE_INVALID_TOKEN),
    ).rejects.toMatchObject({ kind: "Unauthorized" });

    const adapter = second.createAdapter(repositories[0].coordinates, {
      accessToken: TOKEN,
    });
    expect((await adapter.inspect()).kind).toBe("populated");
  });
});
