import type { Change, ChangeSet } from "../../changes/change";
import { EMPTY_SHARES } from "../../share/share-index";
import {
  encodeChangeSet,
  encodeInitializeMessage,
} from "../../changes/encode-change-set";
import { argon2idDirect, type Argon2idFunction } from "../../crypto/argon2";
import { createRepoConfig } from "../../crypto/keyring";
import { InMemoryGitRepo } from "../../forge/fake/in-memory-git-repo";
import { REPO_CONFIG_PATH } from "../../format/v1";
import {
  applyChangeToTags,
  EMPTY_TAGS,
  type TagIndex,
} from "../../tags/tag-index";
import { keysBetween } from "../../order/fractional-key";
import {
  applyChangeToOrder,
  EMPTY_ORDER,
  type OrderIndex,
} from "../../order/order-index";
import { createTrashEntryId } from "../../trash/trash-entry-id";
import { largeTreeSource } from "./large-tree-source";
import { createSeededRandom } from "./seeded-random";
import {
  SAMPLE_NOTES_REPO_PASSPHRASE,
  sampleNotesRepoOrder,
  sampleNotesRepoSource,
  sampleNotesRepoTags,
  sampleSearchRepoSource,
  sampleSearchRepoTags,
  sampleSearchRepoTrashed,
  sampleTrashRepoSource,
  sampleTrashRepoTrashed,
  type SampleEntry,
  type SampleFolderOrder,
  type SampleTag,
  type SampleTrashEntry,
} from "./sample-source";

export interface SampleNotesRepo {
  readonly passphrase: string;
  readonly commits: readonly {
    readonly message: string;
    readonly files: Readonly<Record<string, string>>;
  }[];
}

const SEED = 0x676e6f74;
const LARGE_TREE_SEED = 0x6c617267;
const TRASH_SEED = 0x74726173;
const SEARCH_SEED = 0x73656172;
const README_TEXT = "# Notes\n\nThis repository is managed by commitnote.\n";

function buildChangeSet(source: readonly SampleEntry[]): ChangeSet {
  const changes: Change[] = [];

  function walk(
    entries: readonly SampleEntry[],
    parentPath: readonly string[],
  ): void {
    for (const entry of entries) {
      const path = [...parentPath, entry.name];
      if (entry.kind === "folder") {
        changes.push({ kind: "create-folder", path });
        walk(entry.children, path);
      } else {
        changes.push({ kind: "create-note", path, content: entry.markdown });
      }
    }
  }

  walk(source, []);
  return changes;
}

async function snapshotFiles(
  repo: InMemoryGitRepo,
  treeSha: string,
): Promise<Record<string, string>> {
  const blobs = (await repo.listTreeEntries(treeSha))
    .filter((entry) => entry.type === "blob")
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const files: Record<string, string> = {};
  for (const { path, sha } of blobs) {
    const text = repo.getBlob(sha);
    if (text === undefined) {
      throw new Error(`missing blob ${sha} for ${path}`);
    }
    files[path] = text;
  }
  return files;
}

export function generateSampleNotesRepo(): Promise<SampleNotesRepo> {
  return generateRepo(
    SEED,
    sampleNotesRepoSource,
    [],
    sampleNotesRepoOrder,
    sampleNotesRepoTags,
    argon2idDirect,
  );
}

export function generateSampleTrashRepo(): Promise<SampleNotesRepo> {
  return generateRepo(
    TRASH_SEED,
    sampleTrashRepoSource,
    sampleTrashRepoTrashed,
    [],
    [],
    argon2idDirect,
  );
}

export function generateSampleSearchRepo(): Promise<SampleNotesRepo> {
  return generateRepo(
    SEARCH_SEED,
    sampleSearchRepoSource,
    sampleSearchRepoTrashed,
    [],
    sampleSearchRepoTags,
    argon2idDirect,
  );
}

export function generateLargeTreeRepo(
  argon2id: Argon2idFunction,
): Promise<SampleNotesRepo> {
  return generateRepo(LARGE_TREE_SEED, largeTreeSource(), [], [], [], argon2id);
}

async function generateRepo(
  seed: number,
  source: readonly SampleEntry[],
  trashed: readonly SampleTrashEntry[],
  order: readonly SampleFolderOrder[],
  tags: readonly SampleTag[],
  argon2id: Argon2idFunction,
): Promise<SampleNotesRepo> {
  const random = createSeededRandom(seed);
  const { configText, keyring } = await createRepoConfig(
    SAMPLE_NOTES_REPO_PASSPHRASE,
    {
      random,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      argon2id,
    },
  );

  const repo = new InMemoryGitRepo();

  const commit1Message = encodeInitializeMessage();
  const commit1Tree = await repo.putTree(
    new Map([[REPO_CONFIG_PATH, await repo.putBlob(configText)]]),
  );
  const commit1Sha = await repo.putCommit({
    tree: commit1Tree,
    parent: null,
    message: commit1Message,
  });

  const commits = [{ message: commit1Message, tree: commit1Tree }];
  let parentSha = commit1Sha;
  let parentTree = commit1Tree;

  let orderIndex: OrderIndex = EMPTY_ORDER;
  let tagIndex: TagIndex = EMPTY_TAGS;
  async function commitChanges(changeSet: ChangeSet): Promise<void> {
    const encoded = await encodeChangeSet({
      listing: await repo.listTreeEntries(parentTree),
      changeSet,
      order: orderIndex,
      tags: tagIndex,
      shares: EMPTY_SHARES,
      keyring,
      random,
    });
    orderIndex = changeSet.reduce(applyChangeToOrder, orderIndex);
    tagIndex = changeSet.reduce(applyChangeToTags, tagIndex);
    parentTree = await repo.applyChanges(parentTree, encoded.changes);
    parentSha = await repo.putCommit({
      tree: parentTree,
      parent: parentSha,
      message: encoded.message,
    });
    commits.push({ message: encoded.message, tree: parentTree });
  }

  await commitChanges(buildChangeSet(source));

  if (order.length > 0 || tags.length > 0) {
    await commitChanges([
      ...order.map(({ parent, names }): Change => {
        const keys = keysBetween(null, null, names.length);
        return {
          kind: "set-order",
          parent,
          positions: names.map((name, i) => ({ name, key: keys[i] })),
        };
      }),
      ...tags.map(
        ({ path, color }): Change => ({ kind: "set-color-tag", path, color }),
      ),
    ]);
  }

  for (const entry of trashed) {
    const entryId = createTrashEntryId(
      Date.parse(entry.deletedAt),
      entry.path.length,
      random,
    );
    await commitChanges([
      {
        kind: entry.kind === "note" ? "trash-note" : "trash-folder",
        path: entry.path,
        entryId,
      },
    ]);
  }

  const readmeMessage = "Add README";
  const readmeTree = await repo.applyChanges(parentTree, [
    { kind: "upsert-text", path: "README.md", text: README_TEXT },
  ]);
  await repo.putCommit({
    tree: readmeTree,
    parent: parentSha,
    message: readmeMessage,
  });
  commits.push({ message: readmeMessage, tree: readmeTree });

  return {
    passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
    commits: await Promise.all(
      commits.map(async ({ message, tree }) => ({
        message,
        files: await snapshotFiles(repo, tree),
      })),
    ),
  };
}
