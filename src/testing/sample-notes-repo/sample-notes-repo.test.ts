import { describe, expect, it } from "vitest";
import { argon2idDirect } from "../../crypto/argon2";
import {
  deriveKeyring,
  verifyKeyCheck,
  type Keyring,
} from "../../crypto/keyring";
import { encryptPath } from "../../crypto/name-cipher";
import { decryptNote } from "../../crypto/note-cipher";
import { parseRepoConfig } from "../../crypto/repo-config";
import type { FakeForgeAdapter } from "../../forge/fake/fake-forge-adapter";
import { APP_ID, FOLDER_MARKER, KDF_DEFAULTS, TRAILER } from "../../format/v1";
import {
  buildNoteTree,
  listNotes,
  type FolderNode,
} from "../../tree/note-tree";
import { compareNames } from "../../tree/note-names";
import {
  generateSampleNotesRepo,
  generateSampleTrashRepo,
} from "./generate-sample-notes-repo";
import {
  createSampleNotesRepoAdapter,
  createSampleTrashRepoAdapter,
  sampleNotesRepo,
  sampleTrashRepo,
} from "./seed-sample-notes-repo";
import {
  sampleNotesRepoOrder,
  sampleNotesRepoSource,
  sampleTrashRepoSource,
  sampleTrashRepoTrashed,
  SAMPLE_TRASH_NOW,
  type SampleEntry,
} from "./sample-source";
import { TRASH_DIR, TRASH_RETENTION_MS } from "../../format/v1";
import { buildTrashIndex } from "../../trash/trash-index";
import {
  decryptOrderIndex,
  findOrderEntry,
  siblingComparator,
} from "../../order/order-index";

function flattenNames(entries: readonly SampleEntry[]): string[] {
  const names: string[] = [];
  for (const entry of entries) {
    names.push(entry.name);
    if (entry.kind === "folder") {
      names.push(...flattenNames(entry.children));
    }
  }
  return names;
}

function flattenMarkdown(entries: readonly SampleEntry[]): string[] {
  const markdowns: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "note") {
      markdowns.push(entry.markdown);
    } else {
      markdowns.push(...flattenMarkdown(entry.children));
    }
  }
  return markdowns;
}

function sortedSource(entries: readonly SampleEntry[]): SampleEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return compareNames(a.name, b.name);
  });
}

async function assertTreeMatchesSource(
  node: FolderNode,
  source: readonly SampleEntry[],
  adapter: FakeForgeAdapter,
  keyring: Keyring,
): Promise<void> {
  const expected = sortedSource(source);
  expect(node.children.map((child) => [child.kind, child.name])).toEqual(
    expected.map((entry) => [entry.kind, entry.name]),
  );

  for (let i = 0; i < expected.length; i++) {
    const expectedEntry = expected[i];
    const actualChild = node.children[i];
    if (expectedEntry.kind === "folder") {
      if (actualChild.kind !== "folder") {
        throw new Error(`expected ${actualChild.name} to be a folder`);
      }
      await assertTreeMatchesSource(
        actualChild,
        expectedEntry.children,
        adapter,
        keyring,
      );
    } else {
      if (actualChild.kind !== "note") {
        throw new Error(`expected ${actualChild.name} to be a note`);
      }
      const stored = await adapter.readBlob(actualChild.blobSha);
      const markdown = await decryptNote(keyring, stored);
      expect(markdown).toBe(expectedEntry.markdown);
    }
  }
}

describe("sample notes repo fixture", () => {
  it("regenerating the fixture reproduces the committed JSON exactly", async () => {
    const regenerated = await generateSampleNotesRepo();
    expect(regenerated).toEqual(sampleNotesRepo);
  });

  it("commit 2 carries the save subject, one Create trailer per source entry, and no plaintext leak", () => {
    const message = sampleNotesRepo.commits[1].message;

    expect(message.startsWith("commitnote: save\n\nCommitnote-Format: 1\n")).toBe(
      true,
    );

    const createTrailers = message
      .split("\n")
      .filter((line) => line.startsWith(`${TRAILER.create}:`));
    expect(createTrailers).toHaveLength(10);

    for (const name of flattenNames(sampleNotesRepoSource)) {
      // One source folder is named "commitnote", identical to the app id that
      // legitimately appears in the subject line ("commitnote: save"); that
      // coincidence isn't a plaintext-name leak, so it's exempt here.
      if (name === APP_ID) continue;
      expect(message).not.toContain(name);
    }
    for (const markdown of flattenMarkdown(sampleNotesRepoSource)) {
      expect(message).not.toContain(markdown);
    }
  });

  it("every folder in commit 2 has an empty folder marker", () => {
    const files = sampleNotesRepo.commits[1].files;
    const markerPaths = Object.keys(files).filter((path) =>
      path.endsWith(`/${FOLDER_MARKER}`),
    );

    expect(markerPaths).toHaveLength(5);
    for (const path of markerPaths) {
      expect(files[path]).toBe("");
    }
  });

  it("replays into a fake forge adapter whose head decrypts back to the source", async () => {
    const adapter = await createSampleNotesRepoAdapter();

    const inspection = await adapter.inspect();
    if (inspection.kind !== "populated" || inspection.main === null) {
      throw new Error("expected a populated repo with a main head");
    }
    const repoConfigText = inspection.main.repoConfigText;
    if (repoConfigText === null) {
      throw new Error("expected a repo config text");
    }

    const parsed = parseRepoConfig(repoConfigText);
    if (parsed.kind !== "valid") {
      throw new Error(`expected a valid repo config, got ${parsed.kind}`);
    }
    expect(parsed.config.kdf.memoryKiB).toBe(KDF_DEFAULTS.memoryKiB);
    expect(parsed.config.kdf.iterations).toBe(KDF_DEFAULTS.iterations);
    expect(parsed.config.kdf.parallelism).toBe(KDF_DEFAULTS.parallelism);

    const keyring = await deriveKeyring(
      sampleNotesRepo.passphrase,
      parsed.config.kdf,
      argon2idDirect,
    );
    expect(await verifyKeyCheck(keyring, parsed.config)).toBe(true);

    const head = await adapter.getHead();
    const entries = await adapter.listTree(head);
    const tree = await buildNoteTree(entries, keyring);

    await assertTreeMatchesSource(
      tree.root,
      sampleNotesRepoSource,
      adapter,
      keyring,
    );

    const notes = listNotes(tree);
    expect(notes).toHaveLength(5);
    expect(notes.some((note) => note.name === "README.md")).toBe(false);
  });
});

describe("sample notes repo fixture order", () => {
  async function openKeyring(adapter: FakeForgeAdapter): Promise<Keyring> {
    const inspection = await adapter.inspect();
    if (inspection.kind !== "populated" || inspection.main?.repoConfigText == null) {
      throw new Error("expected a populated repo with a config");
    }
    const parsed = parseRepoConfig(inspection.main.repoConfigText);
    if (parsed.kind !== "valid") throw new Error("invalid repo config");
    return deriveKeyring(sampleNotesRepo.passphrase, parsed.config.kdf, argon2idDirect);
  }

  it("records the positions in a save commit naming each positioned item by stored path only", async () => {
    const adapter = await createSampleNotesRepoAdapter();
    const keyring = await openKeyring(adapter);
    const message = sampleNotesRepo.commits[2].message;

    const expected = [`commitnote: save`, "", `${TRAILER.format}: 1`];
    for (const { parent, names } of sampleNotesRepoOrder) {
      for (const name of names) {
        expected.push(`${TRAILER.order}: ${await encryptPath(keyring, [...parent, name])}`);
      }
    }
    expect(message).toBe(expected.join("\n"));
  });

  it("stores an order file that sorts the reordered folder as listed in the source", async () => {
    const adapter = await createSampleNotesRepoAdapter();
    const keyring = await openKeyring(adapter);
    const listing = await adapter.listTree(await adapter.getHead());
    const entry = findOrderEntry(listing);
    if (entry === undefined) throw new Error("expected an order file");

    const stored = await adapter.readBlob(entry.sha);
    const order = await decryptOrderIndex(keyring, stored);

    for (const name of flattenNames(sampleNotesRepoSource)) {
      if (name === APP_ID) continue;
      expect(stored).not.toContain(name);
    }
    expect(order.writable).toBe(true);
    for (const { parent, names } of sampleNotesRepoOrder) {
      const shuffled = [...names]
        .reverse()
        .map((name) => ({ kind: "note" as const, name }));
      expect(
        shuffled.sort(siblingComparator(order, parent)).map((item) => item.name),
      ).toEqual(names);
    }
  });
});

describe("sample trash repo fixture", () => {
  const finalFiles = () =>
    sampleTrashRepo.commits[sampleTrashRepo.commits.length - 1].files;

  async function openKeyring(): Promise<{
    adapter: FakeForgeAdapter;
    keyring: Keyring;
  }> {
    const adapter = await createSampleTrashRepoAdapter();
    const inspection = await adapter.inspect();
    if (inspection.kind !== "populated" || inspection.main?.repoConfigText == null) {
      throw new Error("expected a populated repo with a config");
    }
    const parsed = parseRepoConfig(inspection.main.repoConfigText);
    if (parsed.kind !== "valid") throw new Error("invalid repo config");
    const keyring = await deriveKeyring(
      sampleTrashRepo.passphrase,
      parsed.config.kdf,
      argon2idDirect,
    );
    return { adapter, keyring };
  }

  it("regenerating the fixture reproduces the committed JSON exactly", async () => {
    expect(await generateSampleTrashRepo()).toEqual(sampleTrashRepo);
  });

  it("lays out one trash entry per trashed item, with the depth and date in the id", () => {
    const ids = Object.keys(finalFiles())
      .filter((path) => path.startsWith(`${TRASH_DIR}/`))
      .map((path) => path.split("/")[2]);
    const uniqueIds = [...new Set(ids)].sort();

    expect(uniqueIds).toHaveLength(3);
    expect(uniqueIds.map((id) => id.replace(/-[a-z2-7]{8}$/, ""))).toEqual([
      "20260105T090000Z-2",
      "20260112T103000Z-1",
      "20260927T081500Z-1",
    ]);
    expect(ids.filter((id) => id.startsWith("20260112"))).toHaveLength(2);
  });

  it("leaks no note names or contents into paths or commit messages", () => {
    const names = flattenNames(sampleTrashRepoSource).filter(
      (name) => name !== APP_ID,
    );
    const markdowns = flattenMarkdown(sampleTrashRepoSource);
    const texts = [
      ...Object.keys(finalFiles()),
      ...sampleTrashRepo.commits.map((commit) => commit.message),
    ];
    for (const text of texts) {
      for (const name of names) expect(text).not.toContain(name);
      for (const markdown of markdowns) expect(text).not.toContain(markdown);
    }
  });

  it("indexes the trash entries with decrypted names and expiry relative to the pinned now", async () => {
    const { adapter, keyring } = await openKeyring();
    const entries = await buildTrashIndex(
      await adapter.listTree(await adapter.getHead()),
      keyring,
    );

    expect(
      entries.map((entry) =>
        entry.undecryptable
          ? null
          : [entry.kind, entry.originalPath, new Date(entry.deletedAt).toISOString()],
      ),
    ).toEqual(
      sampleTrashRepoTrashed.map((item) => [
        item.kind,
        item.path,
        item.deletedAt,
      ]),
    );

    const now = Date.parse(SAMPLE_TRASH_NOW);
    expect(entries.map((entry) => now - entry.deletedAt > TRASH_RETENTION_MS)).toEqual([
      true,
      true,
      false,
    ]);

    const folder = entries[1];
    if (folder.undecryptable || folder.tree.kind !== "folder") {
      throw new Error("expected a readable folder entry");
    }
    expect(folder.tree.children.map((child) => child.name)).toEqual(["Outline"]);
  });

  it("keeps the remaining notes in the tree", async () => {
    const { adapter, keyring } = await openKeyring();
    const tree = await buildNoteTree(
      await adapter.listTree(await adapter.getHead()),
      keyring,
    );
    expect(listNotes(tree).map((note) => note.path)).toEqual([
      ["Archive", "Kept note"],
      ["Welcome"],
    ]);
  });
});
