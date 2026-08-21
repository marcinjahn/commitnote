import { describe, expect, it } from "vitest";
import { argon2idDirect } from "../../crypto/argon2";
import {
  deriveKeyring,
  verifyKeyCheck,
  type Keyring,
} from "../../crypto/keyring";
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
import { generateSampleNotesRepo } from "./generate-sample-notes-repo";
import {
  createSampleNotesRepoAdapter,
  sampleNotesRepo,
} from "./seed-sample-notes-repo";
import { sampleNotesRepoSource, type SampleEntry } from "./sample-source";

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
