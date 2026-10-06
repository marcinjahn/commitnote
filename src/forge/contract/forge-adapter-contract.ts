import { describe, expect, it } from "vitest";
import {
  MAIN_BRANCH,
  REPO_CONFIG_DIR,
  REPO_CONFIG_PATH,
  SAVE_SUBJECT,
} from "../../format/v1";
import type {
  CommitFileChange,
  ContentCreatingRequest,
  ForgeAdapter,
} from "../forge-adapter";
import { commitOnBranch } from "../fake/in-memory-git-repo";
import type { InMemoryGitRepo } from "../fake/in-memory-git-repo";
import type { MockFailure } from "../fake/mock-faults";
import { ROOT_LISTING_LIMIT } from "../forge-adapter";
import type { ShareHost, ShareLocator } from "../share-host";

export interface ContractSeed {
  readonly commits: readonly {
    readonly message: string;
    readonly files: Readonly<Record<string, string>>;
    readonly committedAt?: number; // ms since epoch, whole seconds
  }[]; // full snapshots, oldest first, linear
  readonly branch?: string; // branch the last commit is on; default 'main'
}

export type InjectedFailure =
  | {
      readonly kind:
        "Unauthorized" | "Forbidden" | "NotFound" | "Network" | "Server";
    }
  | { readonly kind: "RateLimited"; readonly retryAfterSeconds: number }
  | { readonly kind: "stale" };

export type ContractOperation =
  | "inspect"
  | "initialize"
  | "getHead"
  | "listTree"
  | "readBlob"
  | "commit"
  | "listCommits"
  | "findOldestCommit"
  | "readFileAt";

export type ContractShareOperation = "createShare" | "updateShare" | "deleteShare";

export interface ContractSubject {
  readonly adapter: ForgeAdapter;
  readonly contentCreatingRequests: readonly ContentCreatingRequest[]; // live list captured from onContentCreatingRequest
  pushFromAnotherDevice(changes: readonly CommitFileChange[]): Promise<string>;
  failNext(operation: ContractOperation, failure: InjectedFailure): void;
  failNextShare?(
    operation: ContractShareOperation,
    failure: InjectedFailure,
  ): void;
  readFileAtMain(path: string): Promise<string | undefined>; // inspects backing state directly
  mainHead(): Promise<string | undefined>;
  commitParent(sha: string): Promise<string | null | undefined>;
}

export interface ForgeContractHarness {
  /** Reads the hosted envelope back through the test backend; the shareHost block is skipped when absent. */
  readShare?(
    subject: ContractSubject,
    locator: ShareLocator,
  ): Promise<string | null>;
  createEmpty(options?: {
    canWrite?: boolean;
    defaultBranch?: string;
  }): Promise<ContractSubject>;
  createPopulated(
    seed: ContractSeed,
    options?: { canWrite?: boolean },
  ): Promise<ContractSubject>;
}

export function inMemorySubjectHooks(
  repo: InMemoryGitRepo,
): Pick<
  ContractSubject,
  "pushFromAnotherDevice" | "readFileAtMain" | "mainHead" | "commitParent"
> {
  return {
    pushFromAnotherDevice: (changes) =>
      commitOnBranch(repo, changes, SAVE_SUBJECT),
    async readFileAtMain(path) {
      const head = repo.getRef(MAIN_BRANCH);
      const blobSha = head === undefined ? undefined : repo.fileAt(head, path);
      return blobSha === undefined ? undefined : repo.getBlob(blobSha);
    },
    mainHead: async () => repo.getRef(MAIN_BRANCH),
    commitParent: async (sha) => repo.getCommit(sha)?.parent,
  };
}

export function toMockFailure(
  failure: Exclude<InjectedFailure, { kind: "stale" }>,
): MockFailure {
  switch (failure.kind) {
    case "Unauthorized":
      return { status: 401 };
    case "Forbidden":
      return { status: 403 };
    case "NotFound":
      return { status: 404 };
    case "Server":
      return { status: 500 };
    case "Network":
      return { network: true };
    case "RateLimited":
      return {
        status: 429,
        headers: { "retry-after": String(failure.retryAfterSeconds) },
      };
  }
}

// Independently reproduces git's blob hashing so listTree/readBlob results can
// be checked against a ground truth the harness under test did not compute.
async function gitBlobSha(text: string): Promise<string> {
  const contentBytes = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${contentBytes.byteLength}\0`);
  const full = new Uint8Array(header.byteLength + contentBytes.byteLength);
  full.set(header, 0);
  full.set(contentBytes, header.byteLength);
  const digest = await crypto.subtle.digest("SHA-1", full);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function configSeed(
  extraFiles: Readonly<Record<string, string>> = {},
  configText = "{}",
): ContractSeed {
  return {
    commits: [
      {
        message: "init",
        files: { [REPO_CONFIG_PATH]: configText, ...extraFiles },
      },
    ],
  };
}

async function requireMainHead(subject: ContractSubject): Promise<string> {
  const head = await subject.mainHead();
  if (head === undefined) {
    throw new Error("expected a main head after seeding");
  }
  return head;
}

const HISTORY_START = Date.UTC(2026, 0, 1, 12, 0, 0);
const MINUTE = 60_000;

// Note "n.md" is created, edited, left alone, edited and then deleted.
const HISTORY_COMMITS: readonly ContractSeed["commits"][number][] = [
  { message: "create", files: { "dir/n.md": "one", "o.md": "x" } },
  { message: "edit", files: { "dir/n.md": "two", "o.md": "x" } },
  { message: "other", files: { "dir/n.md": "two", "o.md": "y" } },
  { message: "edit again", files: { "dir/n.md": "three", "o.md": "y" } },
  { message: "delete", files: { "o.md": "y" } },
];
const HISTORY_SEED: ContractSeed = {
  commits: HISTORY_COMMITS.map((commit, index) => ({
    ...commit,
    committedAt: HISTORY_START + index * MINUTE,
  })),
};

/** Seeded commit SHAs, oldest first. */
async function seededShas(subject: ContractSubject): Promise<string[]> {
  const shas: string[] = [];
  for (
    let sha: string | null | undefined = await requireMainHead(subject);
    typeof sha === "string";
    sha = await subject.commitParent(sha)
  ) {
    shas.unshift(sha);
  }
  return shas;
}

export function describeForgeAdapterContract(
  name: string,
  harness: ForgeContractHarness,
): void {
  describe(name, () => {
    describe("inspect", () => {
      it("reports empty for a repo with no commits", async () => {
        const subject = await harness.createEmpty();
        expect(await subject.adapter.inspect()).toEqual({
          kind: "empty",
          canWrite: true,
        });
      });

      it("reports canWrite false for a read-only empty repo", async () => {
        const subject = await harness.createEmpty({ canWrite: false });
        expect(await subject.adapter.inspect()).toEqual({
          kind: "empty",
          canWrite: false,
        });
      });

      it("returns the main head and config text once populated", async () => {
        const subject = await harness.createPopulated(
          configSeed({}, '{"seed":true}'),
        );
        const head = await requireMainHead(subject);
        expect(await subject.adapter.inspect()).toEqual({
          kind: "populated",
          canWrite: true,
          main: { head, repoConfigText: '{"seed":true}', rootEntries: null },
        });
      });

      it("returns repoConfigText null when main has no repo config", async () => {
        const subject = await harness.createPopulated({
          commits: [{ message: "init", files: { "note.md": "hello" } }],
        });
        const head = await requireMainHead(subject);
        expect(await subject.adapter.inspect()).toEqual({
          kind: "populated",
          canWrite: true,
          main: {
            head,
            repoConfigText: null,
            rootEntries: [{ name: "note.md", type: "blob" }],
          },
        });
      });

      it("lists a nested directory only as a root tree entry", async () => {
        const subject = await harness.createPopulated({
          commits: [
            {
              message: "init",
              files: { "README.md": "readme", "docs/guide/a.md": "a" },
            },
          ],
        });
        const inspection = await subject.adapter.inspect();
        const rootEntries =
          inspection.kind === "populated"
            ? [...(inspection.main?.rootEntries ?? [])]
            : [];
        rootEntries.sort((a, b) => (a.name < b.name ? -1 : 1));
        expect(rootEntries).toEqual([
          { name: "README.md", type: "blob" },
          { name: "docs", type: "tree" },
        ]);
      });

      it("lists at least ROOT_LISTING_LIMIT real root names of a larger root", async () => {
        const files: Record<string, string> = {};
        for (let i = 0; i < ROOT_LISTING_LIMIT + 5; i++) {
          files[`file-${String(i).padStart(2, "0")}.txt`] = `content ${i}`;
        }
        const subject = await harness.createPopulated({
          commits: [{ message: "init", files }],
        });
        const inspection = await subject.adapter.inspect();
        const rootEntries =
          inspection.kind === "populated"
            ? (inspection.main?.rootEntries ?? [])
            : [];
        expect(rootEntries.length).toBeGreaterThanOrEqual(ROOT_LISTING_LIMIT);
        for (const entry of rootEntries) {
          expect(files[entry.name]).toBeDefined();
          expect(entry.type).toBe("blob");
        }
      });

      it("reports main as null when only another branch is populated", async () => {
        const subject = await harness.createPopulated({
          ...configSeed(),
          branch: "other",
        });
        expect(await subject.adapter.inspect()).toEqual({
          kind: "populated",
          canWrite: true,
          main: null,
        });
      });
    });

    describe("initialize", () => {
      it("creates the repo config commit on an empty repo", async () => {
        const subject = await harness.createEmpty();
        const result = await subject.adapter.initialize(
          '{"seed":true}',
          "init",
        );
        expect(result.kind).toBe("ok");
        const head = result.kind === "ok" ? result.head : "";

        expect(await subject.adapter.getHead()).toBe(head);

        const entries = await subject.adapter.listTree(head);
        expect(entries).toHaveLength(2);
        const configEntry = entries.find(
          (entry) => entry.path === REPO_CONFIG_PATH,
        );
        const dirEntry = entries.find(
          (entry) => entry.path === REPO_CONFIG_DIR,
        );
        expect(configEntry?.type).toBe("blob");
        expect(dirEntry?.type).toBe("tree");
        expect(await subject.adapter.readBlob(configEntry?.sha ?? "")).toBe(
          '{"seed":true}',
        );
      });

      it("creates the main branch even when the default branch differs", async () => {
        const subject = await harness.createEmpty({ defaultBranch: "master" });
        const result = await subject.adapter.initialize("{}", "init");
        expect(result.kind).toBe("ok");
        const head = result.kind === "ok" ? result.head : "";
        expect(await subject.mainHead()).toBe(head);
      });

      it("becomes stale on a populated repo", async () => {
        const subject = await harness.createPopulated(configSeed());
        expect(await subject.adapter.initialize("{}", "again")).toEqual({
          kind: "stale",
        });
      });

      it("rejects with Forbidden when read-only", async () => {
        const subject = await harness.createEmpty({ canWrite: false });
        await expect(
          subject.adapter.initialize("{}", "init"),
        ).rejects.toMatchObject({ kind: "Forbidden" });
      });
    });

    describe("getHead", () => {
      it("equals the seeded head", async () => {
        const subject = await harness.createPopulated(configSeed());
        expect(await subject.adapter.getHead()).toBe(
          await requireMainHead(subject),
        );
      });

      it("rejects with NotFound when main is missing", async () => {
        const subject = await harness.createPopulated({
          ...configSeed(),
          branch: "other",
        });
        await expect(subject.adapter.getHead()).rejects.toMatchObject({
          kind: "NotFound",
        });
      });
    });

    describe("listTree", () => {
      it("returns blob and implied tree entries sorted by path with git blob SHAs", async () => {
        const files = {
          "a.txt": "root",
          "dir/b.txt": "nested",
          "dir/sub/c.txt": "deep",
        };
        const subject = await harness.createPopulated({
          commits: [{ message: "init", files }],
        });
        const head = await requireMainHead(subject);

        const entries = await subject.adapter.listTree(head);
        const paths = entries.map((entry) => entry.path);
        expect(paths).toEqual([...paths].sort());
        expect(paths).toEqual([
          "a.txt",
          "dir",
          "dir/b.txt",
          "dir/sub",
          "dir/sub/c.txt",
        ]);

        for (const [path, text] of Object.entries(files)) {
          const entry = entries.find((candidate) => candidate.path === path);
          expect(entry?.type).toBe("blob");
          expect(entry?.sha).toBe(await gitBlobSha(text));
        }
      });

      it("rejects with NotFound for an unknown SHA", async () => {
        const subject = await harness.createEmpty();
        await expect(
          subject.adapter.listTree("unknown-sha"),
        ).rejects.toMatchObject({ kind: "NotFound" });
      });
    });

    describe("readBlob", () => {
      it("returns text including non-ASCII content", async () => {
        const text = "héllo 世界 🎉";
        const subject = await harness.createPopulated({
          commits: [{ message: "init", files: { "note.md": text } }],
        });
        const head = await requireMainHead(subject);
        const entries = await subject.adapter.listTree(head);
        const entry = entries.find((candidate) => candidate.path === "note.md");
        if (entry === undefined) {
          throw new Error("expected a note.md entry");
        }

        expect(await subject.adapter.readBlob(entry.sha)).toBe(text);
      });

      it("rejects with NotFound for an unknown SHA", async () => {
        const subject = await harness.createEmpty();
        await expect(
          subject.adapter.readBlob("unknown-sha"),
        ).rejects.toMatchObject({ kind: "NotFound" });
      });

      it("serves a cached blob even after a failure is queued for the same SHA", async () => {
        const text = "cached";
        const subject = await harness.createPopulated({
          commits: [{ message: "init", files: { "note.md": text } }],
        });
        const head = await requireMainHead(subject);
        const entries = await subject.adapter.listTree(head);
        const entry = entries.find((candidate) => candidate.path === "note.md");
        if (entry === undefined) {
          throw new Error("expected a note.md entry");
        }

        expect(await subject.adapter.readBlob(entry.sha)).toBe(text);

        subject.failNext("readBlob", { kind: "Network" });
        expect(await subject.adapter.readBlob(entry.sha)).toBe(text);
      });
    });

    describe("listCommits", () => {
      it("lists the commits that changed the file, newest first, from `from` inclusive", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        const [create, edit, , editAgain, remove] = await seededShas(subject);

        const commits = await subject.adapter.listCommits({
          from: remove,
          path: "dir/n.md",
          limit: 10,
        });

        expect(commits).toEqual([
          {
            sha: remove,
            parents: [editAgain],
            message: "delete",
            committedAt: HISTORY_START + 4 * MINUTE,
          },
          {
            sha: editAgain,
            parents: [expect.any(String)],
            message: "edit again",
            committedAt: HISTORY_START + 3 * MINUTE,
          },
          {
            sha: edit,
            parents: [create],
            message: "edit",
            committedAt: HISTORY_START + MINUTE,
          },
          {
            sha: create,
            parents: [],
            message: "create",
            committedAt: HISTORY_START,
          },
        ]);
      });

      it("starts below a `from` that did not change the file", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        const [create, edit, other] = await seededShas(subject);

        const commits = await subject.adapter.listCommits({
          from: other,
          path: "dir/n.md",
          limit: 10,
        });

        expect(commits.map((commit) => commit.sha)).toEqual([edit, create]);
      });

      it("returns at most `limit` and continues from the last commit's parent", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        const [create, edit, , editAgain, remove] = await seededShas(subject);

        const first = await subject.adapter.listCommits({
          from: remove,
          path: "dir/n.md",
          limit: 2,
        });
        expect(first.map((commit) => commit.sha)).toEqual([remove, editAgain]);

        const second = await subject.adapter.listCommits({
          from: first[first.length - 1].parents[0],
          path: "dir/n.md",
          limit: 2,
        });
        expect(second.map((commit) => commit.sha)).toEqual([edit, create]);
      });

      it("returns no commits for a path that never existed", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        const head = await requireMainHead(subject);

        expect(
          await subject.adapter.listCommits({
            from: head,
            path: "missing.md",
            limit: 10,
          }),
        ).toEqual([]);
      });

      it("rejects with NotFound for an unknown `from`", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        await expect(
          subject.adapter.listCommits({
            from: "0".repeat(40),
            path: "dir/n.md",
            limit: 10,
          }),
        ).rejects.toMatchObject({ kind: "NotFound" });
      });
    });

    describe("findOldestCommit", () => {
      it("returns the only commit that touched the path", async () => {
        const subject = await harness.createPopulated({
          commits: [
            {
              message: "first",
              files: { "a.md": "a" },
              committedAt: HISTORY_START,
            },
            {
              message: "second",
              files: { "a.md": "a", "b.md": "b" },
              committedAt: HISTORY_START + MINUTE,
            },
          ],
        });
        const [first, second] = await seededShas(subject);

        expect(
          await subject.adapter.findOldestCommit({
            from: second,
            path: "b.md",
          }),
        ).toEqual({
          sha: second,
          parents: [first],
          message: "second",
          committedAt: HISTORY_START + MINUTE,
        });
      });

      it("returns the first of several commits that changed the path", async () => {
        const subject = await harness.createPopulated({
          commits: ["v1", "v2", "v3", "v4", "v5"].map((text, index) => ({
            message: `edit ${index + 1}`,
            files: { "p.md": text },
            committedAt: HISTORY_START + index * MINUTE,
          })),
        });
        const [first] = await seededShas(subject);
        const head = await requireMainHead(subject);

        expect(
          await subject.adapter.findOldestCommit({ from: head, path: "p.md" }),
        ).toEqual({
          sha: first,
          parents: [],
          message: "edit 1",
          committedAt: HISTORY_START,
        });
      });

      it("returns null for a path that never existed", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        const head = await requireMainHead(subject);

        expect(
          await subject.adapter.findOldestCommit({
            from: head,
            path: "missing.md",
          }),
        ).toBeNull();
      });

      it("finds the oldest commit of a path left untouched by later commits", async () => {
        const subject = await harness.createPopulated({
          commits: [
            { message: "create", files: { "a.md": "1", "b.md": "1" } },
            { message: "other", files: { "a.md": "1", "b.md": "2" } },
            { message: "other again", files: { "a.md": "1", "b.md": "3" } },
          ],
        });
        const [create] = await seededShas(subject);
        const head = await requireMainHead(subject);

        const oldest = await subject.adapter.findOldestCommit({
          from: head,
          path: "a.md",
        });

        expect(oldest?.sha).toBe(create);
        expect(oldest?.message).toBe("create");
      });

      it("finds the oldest commit of a path that was later deleted", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        const [create] = await seededShas(subject);
        const head = await requireMainHead(subject);

        const oldest = await subject.adapter.findOldestCommit({
          from: head,
          path: "dir/n.md",
        });

        expect(oldest?.sha).toBe(create);
      });

      it("ignores commits newer than `from`", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        const [create, edit] = await seededShas(subject);

        expect(
          (
            await subject.adapter.findOldestCommit({
              from: edit,
              path: "dir/n.md",
            })
          )?.sha,
        ).toBe(create);
        expect(
          await subject.adapter.findOldestCommit({ from: create, path: "o.md" }),
        ).toMatchObject({ sha: create });
      });

      it("rejects with NotFound for an unknown `from`", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        await expect(
          subject.adapter.findOldestCommit({
            from: "0".repeat(40),
            path: "dir/n.md",
          }),
        ).rejects.toMatchObject({ kind: "NotFound" });
      });
    });

    describe("readFileAt", () => {
      it("returns an earlier version of a file with its git blob SHA", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        const [, edit] = await seededShas(subject);

        expect(await subject.adapter.readFileAt(edit, "dir/n.md")).toEqual({
          blobSha: await gitBlobSha("two"),
          text: "two",
        });
      });

      it("returns non-ASCII text", async () => {
        const text = "héllo 世界 🎉";
        const subject = await harness.createPopulated({
          commits: [{ message: "init", files: { "ü dir/nöte.md": text } }],
        });
        const head = await requireMainHead(subject);

        expect(await subject.adapter.readFileAt(head, "ü dir/nöte.md")).toEqual(
          { blobSha: await gitBlobSha(text), text },
        );
      });

      it("returns null for a deleted file, a missing path and a directory", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        const head = await requireMainHead(subject);
        const [create] = await seededShas(subject);

        expect(await subject.adapter.readFileAt(head, "dir/n.md")).toBeNull();
        expect(
          await subject.adapter.readFileAt(create, "missing.md"),
        ).toBeNull();
        expect(await subject.adapter.readFileAt(create, "dir")).toBeNull();
      });
    });

    describe("commit", () => {
      it("applies upsert-text changes", async () => {
        const subject = await harness.createPopulated(configSeed());
        const parent = await requireMainHead(subject);

        const result = await subject.adapter.commit({
          parent,
          changes: [{ kind: "upsert-text", path: "note.md", text: "hello" }],
          message: "save",
        });
        expect(result.kind).toBe("ok");
        const head = result.kind === "ok" ? result.head : "";
        expect(await subject.mainHead()).toBe(head);

        const entries = await subject.adapter.listTree(head);
        const entry = entries.find((candidate) => candidate.path === "note.md");
        expect(entry?.type).toBe("blob");
        expect(await subject.adapter.readBlob(entry?.sha ?? "")).toBe("hello");
      });

      it("writes an empty file", async () => {
        const subject = await harness.createPopulated(configSeed());
        const parent = await requireMainHead(subject);

        const result = await subject.adapter.commit({
          parent,
          changes: [{ kind: "upsert-text", path: "dir/.keep", text: "" }],
          message: "save",
        });
        expect(result.kind).toBe("ok");
        const head = result.kind === "ok" ? result.head : "";

        const entries = await subject.adapter.listTree(head);
        const entry = entries.find(
          (candidate) => candidate.path === "dir/.keep",
        );
        expect(entry?.sha).toBe(await gitBlobSha(""));
        expect(await subject.adapter.readBlob(entry?.sha ?? "")).toBe("");
      });

      it("moves a file by reusing its blob SHA via upsert-blob", async () => {
        const subject = await harness.createPopulated(
          configSeed({ "old.md": "keep me" }),
        );
        const parent = await requireMainHead(subject);
        const beforeEntries = await subject.adapter.listTree(parent);
        const oldEntry = beforeEntries.find(
          (candidate) => candidate.path === "old.md",
        );
        if (oldEntry === undefined) {
          throw new Error("expected an old.md entry");
        }

        const result = await subject.adapter.commit({
          parent,
          changes: [
            { kind: "upsert-blob", path: "new.md", blobSha: oldEntry.sha },
            { kind: "delete", path: "old.md" },
          ],
          message: "move",
        });
        expect(result.kind).toBe("ok");
        const head = result.kind === "ok" ? result.head : "";

        const entries = await subject.adapter.listTree(head);
        expect(entries.some((entry) => entry.path === "old.md")).toBe(false);
        const moved = entries.find((entry) => entry.path === "new.md");
        expect(moved?.sha).toBe(oldEntry.sha);
        expect(await subject.adapter.readBlob(moved?.sha ?? "")).toBe(
          "keep me",
        );
      });

      it("removes a directory once its last file is deleted", async () => {
        const subject = await harness.createPopulated(
          configSeed({ "dir/only.md": "solo" }),
        );
        const parent = await requireMainHead(subject);

        const result = await subject.adapter.commit({
          parent,
          changes: [{ kind: "delete", path: "dir/only.md" }],
          message: "delete",
        });
        expect(result.kind).toBe("ok");
        const head = result.kind === "ok" ? result.head : "";

        const entries = await subject.adapter.listTree(head);
        expect(entries.some((entry) => entry.path.startsWith("dir"))).toBe(
          false,
        );
      });

      it("reflects a combination of changes in the resulting tree and advances main", async () => {
        const subject = await harness.createPopulated(
          configSeed({
            "keep.md": "keep",
            "old.md": "move me",
            "dir/only.md": "solo",
          }),
        );
        const parent = await requireMainHead(subject);
        const beforeEntries = await subject.adapter.listTree(parent);
        const oldEntry = beforeEntries.find(
          (candidate) => candidate.path === "old.md",
        );
        if (oldEntry === undefined) {
          throw new Error("expected an old.md entry");
        }

        const result = await subject.adapter.commit({
          parent,
          changes: [
            { kind: "upsert-text", path: "new.md", text: "brand new" },
            { kind: "upsert-blob", path: "moved.md", blobSha: oldEntry.sha },
            { kind: "delete", path: "old.md" },
            { kind: "delete", path: "dir/only.md" },
          ],
          message: "combo",
        });
        expect(result.kind).toBe("ok");
        const head = result.kind === "ok" ? result.head : "";
        expect(await subject.mainHead()).toBe(head);

        const entries = await subject.adapter.listTree(head);
        const paths = entries.map((entry) => entry.path).sort();
        expect(paths).toEqual(
          [
            REPO_CONFIG_DIR,
            REPO_CONFIG_PATH,
            "keep.md",
            "moved.md",
            "new.md",
          ].sort(),
        );
      });

      it("becomes stale when main moved past the commit's parent", async () => {
        const subject = await harness.createPopulated(configSeed());
        const parent = await requireMainHead(subject);

        await subject.pushFromAnotherDevice([
          {
            kind: "upsert-text",
            path: "elsewhere.md",
            text: "from another device",
          },
        ]);
        const movedHead = await subject.mainHead();

        const result = await subject.adapter.commit({
          parent,
          changes: [{ kind: "upsert-text", path: "mine.md", text: "mine" }],
          message: "save",
        });
        expect(result).toEqual({ kind: "stale" });
        expect(await subject.mainHead()).toBe(movedHead);
      });

      it("rejects with Forbidden when read-only", async () => {
        const subject = await harness.createPopulated(configSeed(), {
          canWrite: false,
        });
        const parent = await requireMainHead(subject);

        await expect(
          subject.adapter.commit({
            parent,
            changes: [{ kind: "upsert-text", path: "note.md", text: "x" }],
            message: "save",
          }),
        ).rejects.toMatchObject({ kind: "Forbidden" });
      });
    });

    describe("atomic commit", () => {
      it("reports atomic commits as available on a default repo", async () => {
        const subject = await harness.createPopulated(configSeed());
        const support = (await subject.adapter.atomicCommitSupport?.()) ?? {
          kind: "available",
        };
        expect(support).toEqual({ kind: "available" });
      });

      it("lands exactly one commit on top of the parent", async () => {
        const subject = await harness.createPopulated(
          configSeed({ "keep.md": "keep", "gone.md": "gone" }),
        );
        const parent = await requireMainHead(subject);

        const result = await subject.adapter.commit({
          parent,
          changes: [
            { kind: "upsert-text", path: "bulk/a.md", text: "a" },
            { kind: "upsert-text", path: "keep.md", text: "kept" },
            { kind: "delete", path: "gone.md" },
          ],
          message: "bulk",
          atomic: true,
        });

        expect(result.kind).toBe("ok");
        const head = result.kind === "ok" ? result.head : "";
        expect(await subject.mainHead()).toBe(head);
        expect(await subject.commitParent(head)).toBe(parent);
        expect(await subject.readFileAtMain("bulk/a.md")).toBe("a");
        expect(await subject.readFileAtMain("keep.md")).toBe("kept");
        expect(await subject.readFileAtMain("gone.md")).toBeUndefined();
      });

      it("becomes stale without changing main when main moved past the parent", async () => {
        const subject = await harness.createPopulated(configSeed());
        const parent = await requireMainHead(subject);
        const movedHead = await subject.pushFromAnotherDevice([
          { kind: "upsert-text", path: "elsewhere.md", text: "theirs" },
        ]);

        const result = await subject.adapter.commit({
          parent,
          changes: [{ kind: "upsert-text", path: "mine.md", text: "mine" }],
          message: "bulk",
          atomic: true,
        });

        expect(result).toEqual({ kind: "stale" });
        expect(await subject.mainHead()).toBe(movedHead);
        expect(await subject.readFileAtMain("mine.md")).toBeUndefined();
      });

      it("reports exactly the atomic commitCost content-creating requests", async () => {
        const subject = await harness.createPopulated(configSeed());
        const parent = await requireMainHead(subject);
        const changes: CommitFileChange[] = [
          { kind: "upsert-text", path: "a.md", text: "one" },
          { kind: "upsert-text", path: "b.md", text: "two" },
        ];

        await subject.adapter.commit({
          parent,
          changes,
          message: "bulk",
          atomic: true,
        });

        expect(subject.contentCreatingRequests).toHaveLength(
          subject.adapter.commitCost(changes, { atomic: true }),
        );
      });
    });

    describe("reporting", () => {
      it("reports exactly commitCost content-creating requests for a commit", async () => {
        const subject = await harness.createPopulated(
          configSeed({ "old.md": "move me" }),
        );
        const parent = await requireMainHead(subject);
        const beforeEntries = await subject.adapter.listTree(parent);
        const oldEntry = beforeEntries.find(
          (candidate) => candidate.path === "old.md",
        );
        if (oldEntry === undefined) {
          throw new Error("expected an old.md entry");
        }
        const changes: CommitFileChange[] = [
          { kind: "upsert-text", path: "a.md", text: "one" },
          { kind: "upsert-text", path: "b.md", text: "two" },
          { kind: "upsert-blob", path: "c.md", blobSha: oldEntry.sha },
          { kind: "delete", path: "old.md" },
        ];

        await subject.adapter.commit({ parent, changes, message: "save" });

        const operations = subject.contentCreatingRequests.map(
          (request) => request.operation,
        );
        expect(operations).toContain("createCommit");
        expect(operations).toHaveLength(subject.adapter.commitCost(changes));
      });

      it("commits a large change set as one commit costing exactly commitCost", async () => {
        const subject = await harness.createPopulated(configSeed());
        const parent = await requireMainHead(subject);
        const changes: CommitFileChange[] = Array.from(
          { length: 1_200 },
          (_, index) => ({
            kind: "upsert-text",
            path: `bulk/${String(index).padStart(4, "0")}.md`,
            text: `note ${index} `.repeat(200),
          }),
        );

        const result = await subject.adapter.commit({
          parent,
          changes,
          message: "bulk",
        });

        expect(result.kind).toBe("ok");
        const head = result.kind === "ok" ? result.head : "";
        expect(subject.contentCreatingRequests).toHaveLength(
          subject.adapter.commitCost(changes),
        );
        const entries = await subject.adapter.listTree(head);
        const bulk = entries.filter(
          (entry) => entry.type === "blob" && entry.path.startsWith("bulk/"),
        );
        expect(bulk).toHaveLength(changes.length);
        const last = changes[changes.length - 1];
        const lastEntry = bulk.find((entry) => entry.path === last.path);
        expect(await subject.adapter.readBlob(lastEntry?.sha ?? "")).toBe(
          last.kind === "upsert-text" ? last.text : "",
        );
      });

      it("reports initialize first when initializing an empty repo", async () => {
        const subject = await harness.createEmpty();
        await subject.adapter.initialize("{}", "init");
        expect(subject.contentCreatingRequests[0]?.operation).toBe(
          "initialize",
        );
      });
    });

    const readShare = harness.readShare;
    describe.skipIf(readShare === undefined)("shareHost", () => {
      async function createSubject(): Promise<{
        subject: ContractSubject;
        host: ShareHost;
      }> {
        const subject = await harness.createPopulated(configSeed());
        const host = subject.adapter.shareHost;
        if (host === undefined) {
          throw new Error("expected the adapter to have a shareHost");
        }
        return { subject, host };
      }

      function read(
        subject: ContractSubject,
        locator: ShareLocator,
      ): Promise<string | null> {
        if (readShare === undefined) {
          throw new Error("unreachable: readShare is absent");
        }
        return readShare(subject, locator);
      }

      function failNextShare(
        subject: ContractSubject,
        operation: ContractShareOperation,
        failure: InjectedFailure,
      ): void {
        if (subject.failNextShare === undefined) {
          throw new Error("expected the subject to support failNextShare");
        }
        subject.failNextShare(operation, failure);
      }

      it("creates a share whose hosted content equals the envelope", async () => {
        const { subject, host } = await createSubject();
        const locator = await host.create("envelope-text");
        expect(["github", "gitlab"]).toContain(locator.provider);
        expect(await read(subject, locator)).toBe("envelope-text");
      });

      it("gives distinct locators to two creates", async () => {
        const { subject, host } = await createSubject();
        const first = await host.create("one");
        const second = await host.create("two");
        expect(second).not.toEqual(first);
        expect(await read(subject, first)).toBe("one");
        expect(await read(subject, second)).toBe("two");
      });

      it("update replaces the hosted content", async () => {
        const { subject, host } = await createSubject();
        const locator = await host.create("before");
        await host.update(locator, "after");
        expect(await read(subject, locator)).toBe("after");
      });

      it("update of a missing share fails with NotFound", async () => {
        const { host } = await createSubject();
        const locator = await host.create("before");
        await host.delete(locator);
        await expect(host.update(locator, "after")).rejects.toMatchObject({
          kind: "NotFound",
        });
      });

      it("reports updateShare", async () => {
        const { subject, host } = await createSubject();
        const locator = await host.create("before");
        await host.update(locator, "after");
        expect(subject.contentCreatingRequests).toEqual([
          { operation: "createShare" },
          { operation: "updateShare" },
        ]);
      });

      it("deletes a share", async () => {
        const { subject, host } = await createSubject();
        const locator = await host.create("gone soon");
        await host.delete(locator);
        expect(await read(subject, locator)).toBeNull();
      });

      it("resolves when deleting an already-deleted share", async () => {
        const { host } = await createSubject();
        const locator = await host.create("gone soon");
        await host.delete(locator);
        await expect(host.delete(locator)).resolves.toBeUndefined();
      });

      it("reports one content-creating request per create and per delete", async () => {
        const { subject, host } = await createSubject();
        const locator = await host.create("x");
        expect(subject.contentCreatingRequests).toEqual([
          { operation: "createShare" },
        ]);
        await host.delete(locator);
        expect(subject.contentCreatingRequests).toEqual([
          { operation: "createShare" },
          { operation: "deleteShare" },
        ]);
      });

      for (const kind of ["Forbidden", "Network"] as const) {
        it(`rejects create with ${kind}`, async () => {
          const { subject, host } = await createSubject();
          failNextShare(subject, "createShare", { kind });
          await expect(host.create("x")).rejects.toMatchObject({ kind });
        });

        it(`rejects update with ${kind}`, async () => {
          const { subject, host } = await createSubject();
          const locator = await host.create("x");
          failNextShare(subject, "updateShare", { kind });
          await expect(host.update(locator, "y")).rejects.toMatchObject({
            kind,
          });
          expect(await read(subject, locator)).toBe("x");
        });

        it(`rejects delete with ${kind}`, async () => {
          const { subject, host } = await createSubject();
          const locator = await host.create("x");
          failNextShare(subject, "deleteShare", { kind });
          await expect(host.delete(locator)).rejects.toMatchObject({ kind });
          expect(await read(subject, locator)).toBe("x");
        });
      }

      it("rejects create and delete with RateLimited", async () => {
        const { subject, host } = await createSubject();
        failNextShare(subject, "createShare", {
          kind: "RateLimited",
          retryAfterSeconds: 30,
        });
        await expect(host.create("x")).rejects.toMatchObject({
          kind: "RateLimited",
          retryAfterMs: 30_000,
        });
        const locator = await host.create("x");
        failNextShare(subject, "updateShare", {
          kind: "RateLimited",
          retryAfterSeconds: 30,
        });
        await expect(host.update(locator, "y")).rejects.toMatchObject({
          kind: "RateLimited",
        });
        failNextShare(subject, "deleteShare", {
          kind: "RateLimited",
          retryAfterSeconds: 30,
        });
        await expect(host.delete(locator)).rejects.toMatchObject({
          kind: "RateLimited",
        });
      });
    });

    describe("errors", () => {
      const errorKinds = [
        "Unauthorized",
        "Forbidden",
        "NotFound",
        "Network",
        "Server",
      ] as const;

      for (const kind of errorKinds) {
        it(`rejects getHead with ${kind}`, async () => {
          const subject = await harness.createPopulated(configSeed());
          subject.failNext("getHead", { kind });
          await expect(subject.adapter.getHead()).rejects.toMatchObject({
            kind,
          });

          expect(await subject.adapter.getHead()).toBe(
            await subject.mainHead(),
          );
        });
      }

      for (const kind of errorKinds) {
        it(`rejects listCommits with ${kind}`, async () => {
          const subject = await harness.createPopulated(HISTORY_SEED);
          const head = await requireMainHead(subject);
          const request = { from: head, path: "dir/n.md", limit: 10 };

          subject.failNext("listCommits", { kind });
          await expect(
            subject.adapter.listCommits(request),
          ).rejects.toMatchObject({ kind });

          expect(await subject.adapter.listCommits(request)).toHaveLength(4);
        });
      }

      for (const kind of errorKinds) {
        it(`rejects findOldestCommit with ${kind}`, async () => {
          const subject = await harness.createPopulated(HISTORY_SEED);
          const [create] = await seededShas(subject);
          const head = await requireMainHead(subject);
          const request = { from: head, path: "dir/n.md" };

          subject.failNext("findOldestCommit", { kind });
          await expect(
            subject.adapter.findOldestCommit(request),
          ).rejects.toMatchObject({ kind });

          expect(
            (await subject.adapter.findOldestCommit(request))?.sha,
          ).toBe(create);
        });
      }

      // A NotFound response means the file is absent, which reads as null.
      for (const kind of errorKinds.filter((k) => k !== "NotFound")) {
        it(`rejects readFileAt with ${kind}`, async () => {
          const subject = await harness.createPopulated(HISTORY_SEED);
          const [create] = await seededShas(subject);

          subject.failNext("readFileAt", { kind });
          await expect(
            subject.adapter.readFileAt(create, "dir/n.md"),
          ).rejects.toMatchObject({ kind });

          expect(
            (await subject.adapter.readFileAt(create, "dir/n.md"))?.text,
          ).toBe("one");
        });
      }

      it("rejects listCommits with RateLimited and converts retryAfterSeconds", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        const head = await requireMainHead(subject);

        subject.failNext("listCommits", {
          kind: "RateLimited",
          retryAfterSeconds: 30,
        });
        await expect(
          subject.adapter.listCommits({
            from: head,
            path: "dir/n.md",
            limit: 1,
          }),
        ).rejects.toMatchObject({ kind: "RateLimited", retryAfterMs: 30_000 });
      });

      it("rejects findOldestCommit with RateLimited and converts retryAfterSeconds", async () => {
        const subject = await harness.createPopulated(HISTORY_SEED);
        const head = await requireMainHead(subject);

        subject.failNext("findOldestCommit", {
          kind: "RateLimited",
          retryAfterSeconds: 30,
        });
        await expect(
          subject.adapter.findOldestCommit({ from: head, path: "dir/n.md" }),
        ).rejects.toMatchObject({ kind: "RateLimited", retryAfterMs: 30_000 });
      });

      it("rejects commit with RateLimited and converts retryAfterSeconds to retryAfterMs", async () => {
        const subject = await harness.createPopulated(configSeed());
        const parent = await requireMainHead(subject);

        subject.failNext("commit", {
          kind: "RateLimited",
          retryAfterSeconds: 120,
        });
        await expect(
          subject.adapter.commit({
            parent,
            changes: [{ kind: "upsert-text", path: "note.md", text: "x" }],
            message: "save",
          }),
        ).rejects.toMatchObject({ kind: "RateLimited", retryAfterMs: 120_000 });

        const result = await subject.adapter.commit({
          parent,
          changes: [{ kind: "upsert-text", path: "note.md", text: "x" }],
          message: "save",
        });
        expect(result.kind).toBe("ok");
      });

      it("returns stale for a queued 'stale' commit failure without changing main", async () => {
        const subject = await harness.createPopulated(configSeed());
        const parent = await requireMainHead(subject);

        subject.failNext("commit", { kind: "stale" });
        const result = await subject.adapter.commit({
          parent,
          changes: [{ kind: "upsert-text", path: "note.md", text: "x" }],
          message: "save",
        });
        expect(result).toEqual({ kind: "stale" });
        expect(await subject.mainHead()).toBe(parent);
      });
    });
  });
}
