import { describe, expect, it } from "vitest";
import { commitFiles, InMemoryGitRepo } from "./in-memory-git-repo";

describe("InMemoryGitRepo blobs", () => {
  it("hashes the empty blob like git", async () => {
    const repo = new InMemoryGitRepo();
    const sha = await repo.putBlob("");
    expect(sha).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(repo.getBlob(sha)).toBe("");
  });

  it("hashes a text blob like git", async () => {
    const repo = new InMemoryGitRepo();
    const sha = await repo.putBlob("hello\n");
    expect(sha).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(repo.getBlob(sha)).toBe("hello\n");
  });

  it("returns undefined for an unknown blob", () => {
    const repo = new InMemoryGitRepo();
    expect(repo.getBlob("deadbeef")).toBeUndefined();
  });
});

describe("InMemoryGitRepo trees and commits", () => {
  it("round-trips trees and commits", async () => {
    const repo = new InMemoryGitRepo();
    const blobSha = await repo.putBlob("content");
    const treeSha = await repo.putTree(new Map([["a.txt", blobSha]]));
    expect(repo.getTree(treeSha)).toEqual(new Map([["a.txt", blobSha]]));

    const commitSha = await repo.putCommit({
      tree: treeSha,
      parent: null,
      message: "first",
    });
    expect(repo.getCommit(commitSha)).toEqual({
      tree: treeSha,
      parent: null,
      message: "first",
    });
  });

  it("gives identical commits distinct SHAs", async () => {
    const repo = new InMemoryGitRepo();
    const treeSha = await repo.putTree(new Map());
    const first = await repo.putCommit({
      tree: treeSha,
      parent: null,
      message: "same",
    });
    const second = await repo.putCommit({
      tree: treeSha,
      parent: null,
      message: "same",
    });
    expect(first).not.toBe(second);
  });
});

describe("InMemoryGitRepo refs", () => {
  it("tracks branch refs and whether any commit exists", async () => {
    const repo = new InMemoryGitRepo();
    expect(repo.hasCommits()).toBe(false);
    expect(repo.getRef("main")).toBeUndefined();

    const treeSha = await repo.putTree(new Map());
    const commitSha = await repo.putCommit({
      tree: treeSha,
      parent: null,
      message: "init",
    });
    repo.setRef("main", commitSha);

    expect(repo.hasCommits()).toBe(true);
    expect(repo.getRef("main")).toBe(commitSha);

    repo.deleteRef("main");
    expect(repo.getRef("main")).toBeUndefined();
    expect(repo.hasCommits()).toBe(true);
  });
});

describe("InMemoryGitRepo.listTreeEntries", () => {
  it("includes implied directories, sorted by path", async () => {
    const repo = new InMemoryGitRepo();
    const rootSha = await repo.putBlob("root");
    const nestedSha = await repo.putBlob("nested");
    const deepSha = await repo.putBlob("deep");
    const treeSha = await repo.putTree(
      new Map([
        ["a.txt", rootSha],
        ["dir/b.txt", nestedSha],
        ["dir/sub/c.txt", deepSha],
      ]),
    );

    const entries = await repo.listTreeEntries(treeSha);
    const paths = entries.map((entry) => entry.path);
    expect(paths).toEqual([
      "a.txt",
      "dir",
      "dir/b.txt",
      "dir/sub",
      "dir/sub/c.txt",
    ]);

    const dirEntry = entries.find((entry) => entry.path === "dir");
    const subEntry = entries.find((entry) => entry.path === "dir/sub");
    expect(dirEntry?.type).toBe("tree");
    expect(subEntry?.type).toBe("tree");
    expect(dirEntry?.sha).not.toBe(subEntry?.sha);
  });

  it("throws NotFound for an unknown tree", async () => {
    const repo = new InMemoryGitRepo();
    await expect(repo.listTreeEntries("missing")).rejects.toMatchObject({
      name: "ForgeError",
      kind: "NotFound",
    });
  });
});

describe("InMemoryGitRepo.applyChanges", () => {
  it("upserts text, reuses blob SHAs, and deletes files", async () => {
    const repo = new InMemoryGitRepo();
    const baseSha = await repo.applyChanges(null, [
      { kind: "upsert-text", path: "dir/a.txt", text: "one" },
      { kind: "upsert-text", path: "dir/b.txt", text: "two" },
    ]);

    const existingBlobSha = await repo.putBlob("reused");
    const nextSha = await repo.applyChanges(baseSha, [
      { kind: "upsert-blob", path: "dir/c.txt", blobSha: existingBlobSha },
      { kind: "delete", path: "dir/a.txt" },
    ]);

    const files = repo.getTree(nextSha);
    expect(files).toEqual(
      new Map([
        ["dir/b.txt", await repo.putBlob("two")],
        ["dir/c.txt", existingBlobSha],
      ]),
    );
  });

  it("removes a directory once its last file is deleted", async () => {
    const repo = new InMemoryGitRepo();
    const baseSha = await repo.applyChanges(null, [
      { kind: "upsert-text", path: "dir/only.txt", text: "solo" },
    ]);

    const afterDelete = await repo.applyChanges(baseSha, [
      { kind: "delete", path: "dir/only.txt" },
    ]);
    const entries = await repo.listTreeEntries(afterDelete);
    expect(entries).toEqual([]);
  });

  it("throws NotFound when upsert-blob names an unknown blob", async () => {
    const repo = new InMemoryGitRepo();
    await expect(
      repo.applyChanges(null, [
        { kind: "upsert-blob", path: "x.txt", blobSha: "unknown" },
      ]),
    ).rejects.toMatchObject({ name: "ForgeError", kind: "NotFound" });
  });
});

describe("commitFiles", () => {
  it("stores a full snapshot as a single commit and points the branch at it", async () => {
    const repo = new InMemoryGitRepo();
    const commitSha = await commitFiles(repo, {
      parent: null,
      files: { "a.txt": "one", "dir/b.txt": "two" },
      message: "seed",
      branch: "main",
    });

    expect(repo.getRef("main")).toBe(commitSha);
    const commit = repo.getCommit(commitSha);
    expect(commit?.message).toBe("seed");
    expect(commit?.parent).toBeNull();

    const files = repo.getTree(commit?.tree ?? "");
    expect(files?.get("a.txt")).toBeDefined();
    expect(files?.get("dir/b.txt")).toBeDefined();
    expect(repo.getBlob(files?.get("a.txt") ?? "")).toBe("one");
  });
});
