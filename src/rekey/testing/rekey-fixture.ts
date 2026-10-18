import {
  decryptImage,
  encryptImage,
  type ImagePayload,
} from "../../crypto/image-cipher";
import {
  createRepoConfig,
  deriveKeyring,
  verifyKeyCheck,
  type Keyring,
} from "../../crypto/keyring";
import { decryptName, encryptPath } from "../../crypto/name-cipher";
import { decryptNote, encryptNote } from "../../crypto/note-cipher";
import { parseRepoConfig } from "../../crypto/repo-config";
import { fastArgon2id } from "../../crypto/testing/test-keyring";
import { FakeForgeAdapter } from "../../forge/fake/fake-forge-adapter";
import {
  commitFiles,
  InMemoryGitRepo,
} from "../../forge/fake/in-memory-git-repo";
import type { ForgeAdapter, TreeEntry } from "../../forge/forge-adapter";
import { gitBlobShaOfBytes } from "../../forge/git-blob-sha";
import {
  FOLDER_MARKER,
  IMAGE_INDEX_PATH,
  IMAGES_DIR,
  MAIN_BRANCH,
  NOTE_PREFIX,
  REPO_CONFIG_PATH,
  TRASH_DIR,
} from "../../format/v1";
import { type ImageId, imageFilePath, imageIdOfPath } from "../../images/image-id";
import { encryptImageIndex } from "../../images/image-index";

export const OLD_PASSPHRASE = "old passphrase";
export const NEW_PASSPHRASE = "new passphrase";
const FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";
export const TRASH_ID = "20260901T000000Z-1-aaaaaaaa";
export const FOREIGN_TRASH_ID = "20260902T000000Z-1-bbbbbbbb";
export const README_TEXT = "# Plaintext readme\n";

export const FIXTURE_NOTES: Readonly<Record<string, string>> = {
  Welcome: "# Welcome\n",
  "Projects/Plan": "# Plan\n\n- [ ] ship\n",
  "Projects/Deep/Nested note": "nested",
  "Zażółć gęślą": "unicode ✓",
};
export const OWNED_IMAGE_ID: ImageId = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
export const TOMBSTONED_IMAGE_ID: ImageId = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
export const IMAGE_PAYLOAD: ImagePayload = {
  type: "image/webp",
  width: 3,
  height: 2,
  bytes: Uint8Array.of(0, 1, 2, 250, 251, 252, 253, 254, 255),
};
const TOMBSTONED_IMAGE_SHA = "0".repeat(40);
const TOMBSTONE_REMOVED_AT = Date.parse("2026-09-01T00:00:00.000Z");

/**
 * An image file owned by the `Welcome` note and a tombstoned image without a
 * file, with a matching image index.
 */
export async function fixtureImages(
  keyring: Keyring,
): Promise<Record<string, string | Uint8Array>> {
  const envelope = await encryptImage(keyring, OWNED_IMAGE_ID, IMAGE_PAYLOAD);
  return {
    [imageFilePath(OWNED_IMAGE_ID)]: envelope,
    [IMAGE_INDEX_PATH]: await encryptImageIndex(keyring, {
      writable: true,
      images: new Map([
        [
          OWNED_IMAGE_ID,
          {
            blobSha: await gitBlobShaOfBytes(envelope),
            owners: [{ state: "active", path: ["Welcome"] }],
          },
        ],
      ]),
      tombstones: new Map([
        [
          TOMBSTONED_IMAGE_ID,
          { blobSha: TOMBSTONED_IMAGE_SHA, removedAt: TOMBSTONE_REMOVED_AT },
        ],
      ]),
    }),
  };
}

const FIXTURE_EMPTY_FOLDERS = ["Projects/Empty", "Archive"];
export const TRASHED_NOTE = { name: "Old idea", content: "trashed body" };

export async function keyringFor(
  passphrase: string,
  configText: string,
): Promise<Keyring> {
  const parsed = parseRepoConfig(configText);
  if (parsed.kind !== "valid") throw new Error("invalid config");
  return deriveKeyring(passphrase, parsed.config.kdf, fastArgon2id);
}

export async function newRepoConfig(passphrase: string) {
  return createRepoConfig(passphrase, {
    argon2id: fastArgon2id,
    now: () => new Date(FIXTURE_CREATED_AT),
  });
}

async function encryptFixtureFiles(
  keyring: Keyring,
  notes: Readonly<Record<string, string>>,
  emptyFolders: readonly string[],
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(notes)) {
    files[await encryptPath(keyring, path.split("/"))] = await encryptNote(
      keyring,
      content,
    );
  }
  for (const folder of emptyFolders) {
    files[`${await encryptPath(keyring, folder.split("/"))}/${FOLDER_MARKER}`] =
      "";
  }
  return files;
}

export interface RekeyFixture {
  readonly adapter: FakeForgeAdapter;
  readonly oldKeyring: Keyring;
  readonly configText: string;
  readonly head: string;
}

export interface RekeyFixtureOptions {
  readonly extraFiles?: (
    keyring: Keyring,
  ) => Promise<Record<string, string | Uint8Array>>;
  readonly notes?: Readonly<Record<string, string>>;
}

/**
 * Files of a repo with notes, empty folders, a readable and an undecryptable
 * trash entry and a plaintext README, all under OLD_PASSPHRASE.
 */
export async function createRekeyFixtureFiles(
  options?: RekeyFixtureOptions,
): Promise<{
  readonly files: Record<string, string>;
  readonly binaryFiles: Record<string, Uint8Array>;
  readonly keyring: Keyring;
  readonly configText: string;
}> {
  const { configText, keyring } = await newRepoConfig(OLD_PASSPHRASE);
  const foreign = (await newRepoConfig("someone else")).keyring;
  const files: Record<string, string> = {
    [REPO_CONFIG_PATH]: configText,
    "README.md": README_TEXT,
    ...(await encryptFixtureFiles(
      keyring,
      options?.notes ?? FIXTURE_NOTES,
      FIXTURE_EMPTY_FOLDERS,
    )),
    [`${TRASH_DIR}/${TRASH_ID}/${await encryptPath(keyring, [TRASHED_NOTE.name])}`]:
      await encryptNote(keyring, TRASHED_NOTE.content),
    [`${TRASH_DIR}/${FOREIGN_TRASH_ID}/${await encryptPath(foreign, ["Lost"])}`]:
      await encryptNote(foreign, "lost body"),
  };
  const binaryFiles: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(
    (await options?.extraFiles?.(keyring)) ?? {},
  )) {
    if (typeof content === "string") files[path] = content;
    else binaryFiles[path] = content;
  }
  return { files, binaryFiles, keyring, configText };
}

export async function createRekeyFixture(
  options?: RekeyFixtureOptions,
): Promise<RekeyFixture> {
  const { files, binaryFiles, keyring, configText } =
    await createRekeyFixtureFiles(options);
  const repo = new InMemoryGitRepo();
  const head = await commitFiles(repo, {
    parent: null,
    files,
    binaryFiles,
    message: "seed",
    branch: MAIN_BRANCH,
  });
  return {
    adapter: new FakeForgeAdapter({ repo }),
    oldKeyring: keyring,
    configText,
    head,
  };
}

/** `files` holds every text file; `images` the files under the images directory. */
export async function readTree(
  adapter: Pick<ForgeAdapter, "getHead" | "listTree" | "readBlob" | "readBlobBytes">,
): Promise<{
  readonly head: string;
  readonly files: Map<string, string>;
  readonly images: Map<string, Uint8Array>;
}> {
  const head = await adapter.getHead();
  const listing: TreeEntry[] = await adapter.listTree(head);
  const files = new Map<string, string>();
  const images = new Map<string, Uint8Array>();
  for (const entry of listing) {
    if (entry.type !== "blob") continue;
    if (entry.path.startsWith(`${IMAGES_DIR}/`)) {
      images.set(entry.path, await adapter.readBlobBytes(entry.sha));
    } else {
      files.set(entry.path, await adapter.readBlob(entry.sha));
    }
  }
  return { head, files, images };
}

/** Plaintext view of a tree; undecryptable segments and bodies stay as stored. */
export async function decryptTree(
  files: ReadonlyMap<string, string>,
  keyring: Keyring,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const [path, text] of files) {
    const names: string[] = [];
    for (const segment of path.split("/")) {
      names.push((await decryptName(keyring, segment)) ?? segment);
    }
    let body = text;
    if (path !== REPO_CONFIG_PATH && text.startsWith(NOTE_PREFIX)) {
      try {
        body = await decryptNote(keyring, text);
      } catch {
        body = text;
      }
    }
    result.set(names.join("/"), path === REPO_CONFIG_PATH ? "<config>" : body);
  }
  return result;
}

export type KeyState = "old" | "new" | "mixed";

/**
 * Whether every name and body readable with one key is readable with that
 * key only: `old` and `new` mean the repo is entirely on that key.
 */
export async function keyStateOf(
  files: ReadonlyMap<string, string>,
  oldKeyring: Keyring,
  newKeyring: Keyring,
  images: ReadonlyMap<string, Uint8Array> = new Map(),
): Promise<KeyState> {
  let oldHits = 0;
  let newHits = 0;
  for (const [path, envelope] of images) {
    const id = imageIdOfPath(path);
    if (id === null) continue;
    for (const keyring of [oldKeyring, newKeyring]) {
      try {
        await decryptImage(keyring, id, envelope);
        if (keyring === oldKeyring) oldHits++;
        else newHits++;
      } catch {
        // Not readable with this key.
      }
    }
  }
  for (const [path, text] of files) {
    for (const segment of path.split("/")) {
      if ((await decryptName(oldKeyring, segment)) !== null) oldHits++;
      if ((await decryptName(newKeyring, segment)) !== null) newHits++;
    }
    if (path === REPO_CONFIG_PATH) {
      const config = parseRepoConfig(text);
      if (config.kind !== "valid") return "mixed";
      if (await verifyKeyCheck(oldKeyring, config.config)) oldHits++;
      if (await verifyKeyCheck(newKeyring, config.config)) newHits++;
      continue;
    }
    for (const keyring of [oldKeyring, newKeyring]) {
      try {
        await decryptNote(keyring, text);
        if (keyring === oldKeyring) oldHits++;
        else newHits++;
      } catch {
        // Not readable with this key.
      }
    }
  }
  if (oldHits > 0 && newHits === 0) return "old";
  if (newHits > 0 && oldHits === 0) return "new";
  return "mixed";
}
