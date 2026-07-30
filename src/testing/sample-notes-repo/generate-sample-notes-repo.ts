import type { Change, ChangeSet } from "../../changes/change";
import {
  encodeChangeSet,
  encodeInitializeMessage,
} from "../../changes/encode-change-set";
import { argon2idDirect } from "../../crypto/argon2";
import { createRepoConfig } from "../../crypto/keyring";
import type { RandomSource } from "../../crypto/random";
import { InMemoryGitRepo } from "../../forge/fake/in-memory-git-repo";
import { REPO_CONFIG_PATH } from "../../format/v1";
import {
  SAMPLE_NOTES_REPO_PASSPHRASE,
  sampleNotesRepoSource,
  type SampleEntry,
} from "./sample-source";

export interface SampleNotesRepo {
  readonly passphrase: string;
  readonly commits: readonly {
    readonly message: string;
    readonly files: Readonly<Record<string, string>>;
  }[];
}

const SEED = 0x676e6f74;
const README_TEXT = "# Notes\n\nThis repository is managed by git-notes.\n";

/** mulberry32: a small, deterministic 32-bit PRNG, used only to make the fixture reproducible. */
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;

  function nextUint32(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  return (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 4) {
      const value = nextUint32();
      bytes[i] = value & 0xff;
      if (i + 1 < length) bytes[i + 1] = (value >>> 8) & 0xff;
      if (i + 2 < length) bytes[i + 2] = (value >>> 16) & 0xff;
      if (i + 3 < length) bytes[i + 3] = (value >>> 24) & 0xff;
    }
    return bytes;
  };
}

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

export async function generateSampleNotesRepo(): Promise<SampleNotesRepo> {
  const random = createSeededRandom(SEED);
  const { configText, keyring } = await createRepoConfig(
    SAMPLE_NOTES_REPO_PASSPHRASE,
    {
      random,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      argon2id: argon2idDirect,
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

  const commit1Entries = await repo.listTreeEntries(commit1Tree);
  const changeSet = buildChangeSet(sampleNotesRepoSource);
  const encoded = await encodeChangeSet({
    listing: commit1Entries,
    changeSet,
    keyring,
    random,
  });
  const commit2Tree = await repo.applyChanges(commit1Tree, encoded.changes);
  const commit2Sha = await repo.putCommit({
    tree: commit2Tree,
    parent: commit1Sha,
    message: encoded.message,
  });

  const commit3Message = "Add README";
  const commit3Tree = await repo.applyChanges(commit2Tree, [
    { kind: "upsert-text", path: "README.md", text: README_TEXT },
  ]);
  await repo.putCommit({
    tree: commit3Tree,
    parent: commit2Sha,
    message: commit3Message,
  });

  return {
    passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
    commits: [
      {
        message: commit1Message,
        files: await snapshotFiles(repo, commit1Tree),
      },
      {
        message: encoded.message,
        files: await snapshotFiles(repo, commit2Tree),
      },
      {
        message: commit3Message,
        files: await snapshotFiles(repo, commit3Tree),
      },
    ],
  };
}
