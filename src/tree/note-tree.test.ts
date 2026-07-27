import { describe, expect, it } from "vitest";
import { argon2idDirect } from "../crypto/argon2";
import { deriveKeyring, type Keyring } from "../crypto/keyring";
import { encryptName } from "../crypto/name-cipher";
import type { KdfParams } from "../crypto/repo-config";
import type { TreeEntry } from "../forge/forge-adapter";
import { FOLDER_MARKER, REPO_CONFIG_PATH } from "../format/v1";
import { buildNoteTree, findNode, listNotes } from "./note-tree";

const REDUCED_KDF: Pick<KdfParams, "memoryKiB" | "iterations" | "parallelism"> =
  {
    memoryKiB: 64,
    iterations: 1,
    parallelism: 1,
  };

async function testKeyring(): Promise<Keyring> {
  return deriveKeyring(
    "correct horse battery staple",
    {
      algorithm: "argon2id",
      ...REDUCED_KDF,
      salt: Uint8Array.from({ length: 16 }, () => 7),
    },
    argon2idDirect,
  );
}

function directoryPrefixesOf(path: string): string[] {
  const segments = path.split("/");
  const prefixes: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    prefixes.push(segments.slice(0, i).join("/"));
  }
  return prefixes;
}

/**
 * Mirrors how a real recursive git tree listing looks: a "blob" entry for
 * every file plus a "tree" entry for every directory that contains at least
 * one file, regardless of whether git-notes will end up ignoring that file.
 */
function entriesFor(files: ReadonlyMap<string, string>): TreeEntry[] {
  const dirs = new Set<string>();
  for (const path of files.keys()) {
    for (const prefix of directoryPrefixesOf(path)) {
      dirs.add(prefix);
    }
  }
  const entries: TreeEntry[] = [];
  for (const [path, sha] of files) {
    entries.push({ path, type: "blob", sha });
  }
  let dirIndex = 0;
  for (const dir of dirs) {
    entries.push({ path: dir, type: "tree", sha: `tree-${dirIndex++}` });
  }
  return entries;
}

async function buildScenario(keyring: Keyring): Promise<{
  entries: TreeEntry[];
  paths: {
    archive: string;
    old: string;
    onlyIgnored: string;
    projects: string;
    ideas: string;
    gitNotes: string;
    roadmap: string;
    aaaa: string;
  };
}> {
  const archive = await encryptName(keyring, "Archive");
  const old = await encryptName(keyring, "Old");
  const onlyIgnored = await encryptName(keyring, "OnlyIgnored");
  const projects = await encryptName(keyring, "Projects");
  const ideas = await encryptName(keyring, "Ideas");
  const gitNotes = await encryptName(keyring, "git-notes");
  const roadmap = await encryptName(keyring, "Roadmap");
  const aaaa = await encryptName(keyring, "AAAA");

  const files = new Map<string, string>([
    [`${archive}/${old}`, "sha-old"],
    [`${onlyIgnored}/${FOLDER_MARKER}`, "sha-keep"],
    [`${projects}/${ideas}`, "sha-ideas"],
    [`${projects}/${gitNotes}/${roadmap}`, "sha-roadmap"],
    [aaaa, "sha-aaaa"],
    ["README.md", "sha-readme"],
    ["Mystery/Secret", "sha-secret"],
    [REPO_CONFIG_PATH, "sha-config"],
  ]);

  return {
    entries: entriesFor(files),
    paths: {
      archive,
      old,
      onlyIgnored,
      projects,
      ideas,
      gitNotes,
      roadmap,
      aaaa,
    },
  };
}

describe("buildNoteTree", () => {
  it("builds nested folders, notes and applies every ignore rule", async () => {
    const keyring = await testKeyring();
    const { entries, paths } = await buildScenario(keyring);
    const tree = await buildNoteTree(entries, keyring);

    expect(tree.root.name).toBe("");
    expect(tree.root.path).toEqual([]);
    expect(tree.root.storedPath).toBe("");

    // Folders sort before notes, regardless of alphabetical order ("AAAA"
    // would otherwise sort before "Archive").
    expect(tree.root.children.map((c) => [c.kind, c.name])).toEqual([
      ["folder", "Archive"],
      ["folder", "OnlyIgnored"],
      ["folder", "Projects"],
      ["note", "AAAA"],
    ]);

    const archive = tree.root.children[0];
    if (archive.kind !== "folder") throw new Error("expected folder");
    expect(archive.storedPath).toBe(paths.archive);
    expect(archive.children).toHaveLength(1);
    const old = archive.children[0];
    expect(old).toEqual({
      kind: "note",
      name: "Old",
      path: ["Archive", "Old"],
      storedPath: `${paths.archive}/${paths.old}`,
      blobSha: "sha-old",
    });

    // A folder whose only child is ignored (here, a .keep marker) is still
    // shown, with no children.
    const onlyIgnored = tree.root.children[1];
    if (onlyIgnored.kind !== "folder") throw new Error("expected folder");
    expect(onlyIgnored.children).toEqual([]);

    const projects = tree.root.children[2];
    if (projects.kind !== "folder") throw new Error("expected folder");
    expect(projects.children.map((c) => [c.kind, c.name])).toEqual([
      ["folder", "git-notes"],
      ["note", "Ideas"],
    ]);

    const gitNotesFolder = projects.children[0];
    if (gitNotesFolder.kind !== "folder") throw new Error("expected folder");
    expect(gitNotesFolder.path).toEqual(["Projects", "git-notes"]);
    expect(gitNotesFolder.children).toEqual([
      {
        kind: "note",
        name: "Roadmap",
        path: ["Projects", "git-notes", "Roadmap"],
        storedPath: `${paths.projects}/${paths.gitNotes}/${paths.roadmap}`,
        blobSha: "sha-roadmap",
      },
    ]);

    const aaaaNote = tree.root.children[3];
    expect(aaaaNote).toEqual({
      kind: "note",
      name: "AAAA",
      path: ["AAAA"],
      storedPath: paths.aaaa,
      blobSha: "sha-aaaa",
    });
  });

  it("ignores an undecryptable tree and everything beneath it", async () => {
    const keyring = await testKeyring();
    const { entries } = await buildScenario(keyring);
    const tree = await buildNoteTree(entries, keyring);

    expect(findNode(tree, ["Mystery"])).toBeUndefined();
    expect(tree.root.children.some((c) => c.storedPath === "Mystery")).toBe(
      false,
    );
  });

  it("ignores everything under the repo config directory", async () => {
    const keyring = await testKeyring();
    const { entries } = await buildScenario(keyring);
    const tree = await buildNoteTree(entries, keyring);

    expect(
      tree.root.children.some((c) => c.storedPath.startsWith(".gitnotes")),
    ).toBe(false);
  });

  it("ignores a plaintext top-level file like README.md", async () => {
    const keyring = await testKeyring();
    const { entries } = await buildScenario(keyring);
    const tree = await buildNoteTree(entries, keyring);

    expect(tree.root.children.some((c) => c.storedPath === "README.md")).toBe(
      false,
    );
  });
});

describe("findNode", () => {
  it("finds the root for the empty path", async () => {
    const keyring = await testKeyring();
    const { entries } = await buildScenario(keyring);
    const tree = await buildNoteTree(entries, keyring);
    expect(findNode(tree, [])).toBe(tree.root);
  });

  it("finds a deeply nested note", async () => {
    const keyring = await testKeyring();
    const { entries, paths } = await buildScenario(keyring);
    const tree = await buildNoteTree(entries, keyring);
    const node = findNode(tree, ["Projects", "git-notes", "Roadmap"]);
    expect(node).toEqual({
      kind: "note",
      name: "Roadmap",
      path: ["Projects", "git-notes", "Roadmap"],
      storedPath: `${paths.projects}/${paths.gitNotes}/${paths.roadmap}`,
      blobSha: "sha-roadmap",
    });
  });

  it("returns undefined for a path that does not exist", async () => {
    const keyring = await testKeyring();
    const { entries } = await buildScenario(keyring);
    const tree = await buildNoteTree(entries, keyring);
    expect(findNode(tree, ["Nope"])).toBeUndefined();
  });

  it("returns undefined when descending through a note", async () => {
    const keyring = await testKeyring();
    const { entries } = await buildScenario(keyring);
    const tree = await buildNoteTree(entries, keyring);
    expect(findNode(tree, ["AAAA", "Nested"])).toBeUndefined();
  });
});

describe("listNotes", () => {
  it("lists notes depth-first in display order", async () => {
    const keyring = await testKeyring();
    const { entries } = await buildScenario(keyring);
    const tree = await buildNoteTree(entries, keyring);

    expect(listNotes(tree).map((n) => n.path)).toEqual([
      ["Archive", "Old"],
      ["Projects", "git-notes", "Roadmap"],
      ["Projects", "Ideas"],
      ["AAAA"],
    ]);
  });
});
