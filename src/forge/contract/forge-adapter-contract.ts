import { describe, expect, it } from "vitest";
import { REPO_CONFIG_DIR, REPO_CONFIG_PATH } from "../../format/v1";
import type {
  CommitFileChange,
  ContentCreatingRequest,
  ForgeAdapter,
} from "../forge-adapter";
import { ROOT_LISTING_LIMIT } from "../forge-adapter";

export interface ContractSeed {
  readonly commits: readonly {
    readonly message: string;
    readonly files: Readonly<Record<string, string>>;
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
  "inspect" | "initialize" | "getHead" | "listTree" | "readBlob" | "commit";

export interface ContractSubject {
  readonly adapter: ForgeAdapter;
  readonly contentCreatingRequests: readonly ContentCreatingRequest[]; // live list captured from onContentCreatingRequest
  pushFromAnotherDevice(changes: readonly CommitFileChange[]): Promise<string>;
  failNext(operation: ContractOperation, failure: InjectedFailure): void;
  readFileAtMain(path: string): Promise<string | undefined>; // inspects backing state directly
  mainHead(): Promise<string | undefined>;
  commitParent(sha: string): Promise<string | null | undefined>;
}

export interface ForgeContractHarness {
  createEmpty(options?: {
    canWrite?: boolean;
    defaultBranch?: string;
  }): Promise<ContractSubject>;
  createPopulated(
    seed: ContractSeed,
    options?: { canWrite?: boolean },
  ): Promise<ContractSubject>;
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
        const entry = entries.find((candidate) => candidate.path === "dir/.keep");
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
