import { describe, expect, it } from "vitest";
import { argon2idDirect } from "../crypto/argon2";
import { deriveKeyring, type Keyring } from "../crypto/keyring";
import { decryptNote } from "../crypto/note-cipher";
import { encryptPath } from "../crypto/name-cipher";
import type { KdfParams } from "../crypto/repo-config";
import type { TreeEntry } from "../forge/forge-adapter";
import { FOLDER_MARKER } from "../format/v1";
import type { ChangeSet } from "./change";
import {
  encodeChangeSet,
  encodeInitializeMessage,
  InvalidChangeSetError,
} from "./encode-change-set";

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
      salt: Uint8Array.from({ length: 16 }, () => 9),
    },
    argon2idDirect,
  );
}

function blob(path: string, sha: string): TreeEntry {
  return { path, type: "blob", sha };
}

function keepBlob(folderStoredPath: string, sha: string): TreeEntry {
  return blob(`${folderStoredPath}/${FOLDER_MARKER}`, sha);
}

async function decryptText(keyring: Keyring, text: string): Promise<string> {
  return decryptNote(keyring, text);
}

describe("encodeChangeSet: one test per operation type", () => {
  it("create-note: adds an upsert-text at the stored path and one Create trailer", async () => {
    const keyring = await testKeyring();
    const storedNote = await encryptPath(keyring, ["Note"]);
    const changeSet: ChangeSet = [
      { kind: "create-note", path: ["Note"], content: "hello world" },
    ];

    const result = await encodeChangeSet({ listing: [], changeSet, keyring });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].kind).toBe("upsert-text");
    expect(result.changes[0].path).toBe(storedNote);
    if (result.changes[0].kind === "upsert-text") {
      await expect(decryptText(keyring, result.changes[0].text)).resolves.toBe(
        "hello world",
      );
    }
    expect(result.message).toContain(`Commitnote-Create: ${storedNote}`);
  });

  it("create-folder: yields exactly <stored>/.keep with text '' and one Create trailer", async () => {
    const keyring = await testKeyring();
    const storedFolder = await encryptPath(keyring, ["Folder"]);
    const changeSet: ChangeSet = [{ kind: "create-folder", path: ["Folder"] }];

    const result = await encodeChangeSet({ listing: [], changeSet, keyring });

    expect(result.changes).toEqual([
      {
        kind: "upsert-text",
        path: `${storedFolder}/${FOLDER_MARKER}`,
        text: "",
      },
    ]);
    expect(result.message).toBe(
      `commitnote: save\n\nCommitnote-Format: 1\nCommitnote-Create: ${storedFolder}`,
    );
  });

  it("update-note: sets new ciphertext at the existing stored path and one Update trailer", async () => {
    const keyring = await testKeyring();
    const storedNote = await encryptPath(keyring, ["Note"]);
    const listing = [blob(storedNote, "old-sha")];
    const changeSet: ChangeSet = [
      { kind: "update-note", path: ["Note"], content: "updated body" },
    ];

    const result = await encodeChangeSet({ listing, changeSet, keyring });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      kind: "upsert-text",
      path: storedNote,
    });
    if (result.changes[0].kind === "upsert-text") {
      await expect(decryptText(keyring, result.changes[0].text)).resolves.toBe(
        "updated body",
      );
    }
    expect(result.message).toContain(`Commitnote-Update: ${storedNote}`);
  });

  it("delete-note: removes the file at the stored path and one Delete trailer", async () => {
    const keyring = await testKeyring();
    const storedNote = await encryptPath(keyring, ["Note"]);
    const listing = [blob(storedNote, "some-sha")];
    const changeSet: ChangeSet = [{ kind: "delete-note", path: ["Note"] }];

    const result = await encodeChangeSet({ listing, changeSet, keyring });

    expect(result.changes).toEqual([{ kind: "delete", path: storedNote }]);
    expect(result.message).toBe(
      `commitnote: save\n\nCommitnote-Format: 1\nCommitnote-Delete: ${storedNote}`,
    );
  });

  it("delete-folder: removes all files under it, including foreign ones, with one Delete trailer", async () => {
    const keyring = await testKeyring();
    const storedFolder = await encryptPath(keyring, ["Folder"]);
    const storedNote = await encryptPath(keyring, ["Folder", "Note"]);
    const foreignPath = `${storedFolder}/not-a-valid-ciphertext-segment`;
    const listing = [
      keepBlob(storedFolder, "sha-keep"),
      blob(storedNote, "sha-note"),
      blob(foreignPath, "sha-foreign"),
    ];
    const changeSet: ChangeSet = [{ kind: "delete-folder", path: ["Folder"] }];

    const result = await encodeChangeSet({ listing, changeSet, keyring });

    expect(result.changes).toHaveLength(3);
    expect(result.changes).toContainEqual({
      kind: "delete",
      path: `${storedFolder}/${FOLDER_MARKER}`,
    });
    expect(result.changes).toContainEqual({ kind: "delete", path: storedNote });
    expect(result.changes).toContainEqual({
      kind: "delete",
      path: foreignPath,
    });
    expect(result.message).toBe(
      `commitnote: save\n\nCommitnote-Format: 1\nCommitnote-Delete: ${storedFolder}`,
    );
  });

  it("rename-note: moves the entry via upsert-blob reusing the blob SHA into another folder", async () => {
    const keyring = await testKeyring();
    const storedNote = await encryptPath(keyring, ["ExistingNote"]);
    const storedTargetFolder = await encryptPath(keyring, ["Target"]);
    const storedTo = await encryptPath(keyring, ["Target", "ExistingNote"]);
    const listing = [
      blob(storedNote, "sha-note"),
      keepBlob(storedTargetFolder, "sha-keep"),
    ];
    const changeSet: ChangeSet = [
      {
        kind: "rename-note",
        from: ["ExistingNote"],
        to: ["Target", "ExistingNote"],
      },
    ];

    const result = await encodeChangeSet({ listing, changeSet, keyring });

    expect(result.changes).toHaveLength(2);
    expect(result.changes).toContainEqual({ kind: "delete", path: storedNote });
    expect(result.changes).toContainEqual({
      kind: "upsert-blob",
      path: storedTo,
      blobSha: "sha-note",
    });
    expect(result.message).toBe(
      `commitnote: save\n\nCommitnote-Format: 1\nCommitnote-Rename: ${storedNote} -> ${storedTo}`,
    );
  });

  it("rename-folder: moves every path under it via upsert-blob, including nested notes, a .keep and a foreign undecryptable file", async () => {
    const keyring = await testKeyring();
    const storedFrom = await encryptPath(keyring, ["From"]);
    const storedTo = await encryptPath(keyring, ["To"]);
    const storedSub = await encryptPath(keyring, ["From", "Sub"]);
    const storedNote1 = await encryptPath(keyring, ["From", "Note1"]);
    const storedNote2 = await encryptPath(keyring, ["From", "Sub", "Note2"]);
    const foreignPath = `${storedFrom}/not-a-valid-ciphertext-segment`;

    const listing = [
      keepBlob(storedFrom, "sha-keep"),
      blob(storedNote1, "sha-note1"),
      blob(storedNote2, "sha-note2"),
      keepBlob(storedSub, "sha-sub-keep"),
      blob(foreignPath, "sha-foreign"),
    ];
    const changeSet: ChangeSet = [
      { kind: "rename-folder", from: ["From"], to: ["To"] },
    ];

    const result = await encodeChangeSet({ listing, changeSet, keyring });

    const renamed = (originalPath: string): string =>
      `${storedTo}${originalPath.slice(storedFrom.length)}`;

    expect(result.changes).toHaveLength(10);
    for (const [originalPath, sha] of [
      [`${storedFrom}/${FOLDER_MARKER}`, "sha-keep"],
      [storedNote1, "sha-note1"],
      [storedNote2, "sha-note2"],
      [`${storedSub}/${FOLDER_MARKER}`, "sha-sub-keep"],
      [foreignPath, "sha-foreign"],
    ] as const) {
      expect(result.changes).toContainEqual({
        kind: "delete",
        path: originalPath,
      });
      expect(result.changes).toContainEqual({
        kind: "upsert-blob",
        path: renamed(originalPath),
        blobSha: sha,
      });
    }
    expect(result.message).toBe(
      `commitnote: save\n\nCommitnote-Format: 1\nCommitnote-Rename: ${storedFrom} -> ${storedTo}`,
    );
  });
});

describe("encodeChangeSet: multi-change scenarios", () => {
  it("applies a nested create-folder then create-note inside it in one change set", async () => {
    const keyring = await testKeyring();
    const storedFolder = await encryptPath(keyring, ["Folder"]);
    const storedNote = await encryptPath(keyring, ["Folder", "Note"]);
    const changeSet: ChangeSet = [
      { kind: "create-folder", path: ["Folder"] },
      { kind: "create-note", path: ["Folder", "Note"], content: "nested body" },
    ];

    const result = await encodeChangeSet({ listing: [], changeSet, keyring });

    expect(result.changes).toHaveLength(2);
    expect(result.changes).toContainEqual({
      kind: "upsert-text",
      path: `${storedFolder}/${FOLDER_MARKER}`,
      text: "",
    });
    const noteChange = result.changes.find((c) => c.path === storedNote);
    expect(noteChange?.kind).toBe("upsert-text");
    if (noteChange?.kind === "upsert-text") {
      await expect(decryptText(keyring, noteChange.text)).resolves.toBe(
        "nested body",
      );
    }
    expect(result.message).toBe(
      `commitnote: save\n\nCommitnote-Format: 1\nCommitnote-Create: ${storedFolder}\nCommitnote-Create: ${storedNote}`,
    );
  });

  it("create then update then rename of the same note gives one upsert-text at the final path and three trailers in order", async () => {
    const keyring = await testKeyring();
    const storedNote = await encryptPath(keyring, ["Note"]);
    const storedRenamed = await encryptPath(keyring, ["Renamed"]);
    const changeSet: ChangeSet = [
      { kind: "create-note", path: ["Note"], content: "v1" },
      { kind: "update-note", path: ["Note"], content: "v2" },
      { kind: "rename-note", from: ["Note"], to: ["Renamed"] },
    ];

    const result = await encodeChangeSet({ listing: [], changeSet, keyring });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].kind).toBe("upsert-text");
    expect(result.changes[0].path).toBe(storedRenamed);
    if (result.changes[0].kind === "upsert-text") {
      await expect(decryptText(keyring, result.changes[0].text)).resolves.toBe(
        "v2",
      );
    }
    expect(result.message).toBe(
      `commitnote: save\n\nCommitnote-Format: 1\nCommitnote-Create: ${storedNote}\nCommitnote-Update: ${storedNote}\nCommitnote-Rename: ${storedNote} -> ${storedRenamed}`,
    );
  });

  it("produces the exact pinned message for a mixed change set", async () => {
    const keyring = await testKeyring();
    const storedKeep = await encryptPath(keyring, ["Keep"]);
    const storedToDelete = await encryptPath(keyring, ["ToDelete"]);
    const storedToUpdate = await encryptPath(keyring, ["ToUpdate"]);
    const storedNewNote = await encryptPath(keyring, ["NewNote"]);
    const storedNewFolder = await encryptPath(keyring, ["NewFolder"]);
    const storedFrom = await encryptPath(keyring, ["ToRenameFolder"]);
    const storedTo = await encryptPath(keyring, ["RenamedFolder"]);

    const listing = [
      blob(storedKeep, "sha-keep"),
      blob(storedToDelete, "sha-to-delete"),
      blob(storedToUpdate, "sha-to-update"),
      keepBlob(storedFrom, "sha-rf-keep"),
    ];
    const changeSet: ChangeSet = [
      { kind: "create-note", path: ["NewNote"], content: "new note body" },
      { kind: "update-note", path: ["ToUpdate"], content: "updated body" },
      { kind: "delete-note", path: ["ToDelete"] },
      { kind: "create-folder", path: ["NewFolder"] },
      {
        kind: "rename-folder",
        from: ["ToRenameFolder"],
        to: ["RenamedFolder"],
      },
    ];

    const result = await encodeChangeSet({ listing, changeSet, keyring });

    expect(result.message).toBe(
      `commitnote: save\n\n` +
        `Commitnote-Format: 1\n` +
        `Commitnote-Create: ${storedNewNote}\n` +
        `Commitnote-Update: ${storedToUpdate}\n` +
        `Commitnote-Delete: ${storedToDelete}\n` +
        `Commitnote-Create: ${storedNewFolder}\n` +
        `Commitnote-Rename: ${storedFrom} -> ${storedTo}`,
    );
    // The untouched note is neither modified nor listed among the changes.
    expect(result.changes.some((c) => c.path === storedKeep)).toBe(false);
  });

  it("never leaks a plaintext name or note content into the commit message", async () => {
    const keyring = await testKeyring();
    const changeSet: ChangeSet = [
      {
        kind: "create-folder",
        path: ["PlaintextFolderName"],
      },
      {
        kind: "create-note",
        path: ["PlaintextFolderName", "PlaintextNoteName"],
        content: "PLAINTEXT_CONTENT_BODY",
      },
    ];

    const result = await encodeChangeSet({ listing: [], changeSet, keyring });

    expect(result.message).not.toContain("PlaintextFolderName");
    expect(result.message).not.toContain("PlaintextNoteName");
    expect(result.message).not.toContain("PLAINTEXT_CONTENT_BODY");
    for (const change of result.changes) {
      if (change.kind === "upsert-text") {
        expect(change.text).not.toContain("PLAINTEXT_CONTENT_BODY");
      }
    }
  });
});

describe("encodeChangeSet: invalid change sets", () => {
  it("rejects an empty change set", async () => {
    const keyring = await testKeyring();
    await expect(
      encodeChangeSet({ listing: [], changeSet: [], keyring }),
    ).rejects.toThrow(InvalidChangeSetError);
  });

  const invalidCases: ReadonlyArray<{
    name: string;
    build: (
      keyring: Keyring,
    ) => Promise<{ listing: TreeEntry[]; changeSet: ChangeSet }>;
  }> = [
    {
      name: "create-folder: parent does not exist",
      build: async () => ({
        listing: [],
        changeSet: [{ kind: "create-folder", path: ["Missing", "Folder"] }],
      }),
    },
    {
      name: "create-folder: path is not free (a note already there)",
      build: async (keyring) => ({
        listing: [blob(await encryptPath(keyring, ["Folder"]), "sha")],
        changeSet: [{ kind: "create-folder", path: ["Folder"] }],
      }),
    },
    {
      name: "create-note: parent does not exist",
      build: async () => ({
        listing: [],
        changeSet: [
          { kind: "create-note", path: ["Missing", "Note"], content: "x" },
        ],
      }),
    },
    {
      name: "create-note: path is not free (a note already there)",
      build: async (keyring) => ({
        listing: [blob(await encryptPath(keyring, ["Existing"]), "sha")],
        changeSet: [{ kind: "create-note", path: ["Existing"], content: "x" }],
      }),
    },
    {
      name: "update-note: no file at the stored path",
      build: async () => ({
        listing: [],
        changeSet: [{ kind: "update-note", path: ["Ghost"], content: "x" }],
      }),
    },
    {
      name: "delete-note: no file at the stored path",
      build: async () => ({
        listing: [],
        changeSet: [{ kind: "delete-note", path: ["Ghost"] }],
      }),
    },
    {
      name: "delete-folder: folder does not exist",
      build: async () => ({
        listing: [],
        changeSet: [{ kind: "delete-folder", path: ["Ghost"] }],
      }),
    },
    {
      name: "rename-note: no file at the from path",
      build: async () => ({
        listing: [],
        changeSet: [{ kind: "rename-note", from: ["Ghost"], to: ["New"] }],
      }),
    },
    {
      name: "rename-note: to path is not free",
      build: async (keyring) => ({
        listing: [
          blob(await encryptPath(keyring, ["A"]), "sha-a"),
          blob(await encryptPath(keyring, ["B"]), "sha-b"),
        ],
        changeSet: [{ kind: "rename-note", from: ["A"], to: ["B"] }],
      }),
    },
    {
      name: "rename-note: to's parent does not exist",
      build: async (keyring) => ({
        listing: [blob(await encryptPath(keyring, ["A"]), "sha-a")],
        changeSet: [{ kind: "rename-note", from: ["A"], to: ["Missing", "B"] }],
      }),
    },
    {
      name: "rename-folder: from does not exist",
      build: async () => ({
        listing: [],
        changeSet: [{ kind: "rename-folder", from: ["Ghost"], to: ["New"] }],
      }),
    },
    {
      name: "rename-folder: to is not free",
      build: async (keyring) => ({
        listing: [
          keepBlob(await encryptPath(keyring, ["From"]), "sha-keep-from"),
          keepBlob(await encryptPath(keyring, ["To"]), "sha-keep-to"),
        ],
        changeSet: [{ kind: "rename-folder", from: ["From"], to: ["To"] }],
      }),
    },
    {
      name: "rename-folder: to is inside from",
      build: async (keyring) => ({
        listing: [keepBlob(await encryptPath(keyring, ["From"]), "sha-keep")],
        changeSet: [
          { kind: "rename-folder", from: ["From"], to: ["From", "Sub"] },
        ],
      }),
    },
    {
      name: "rename-folder: to's parent does not exist",
      build: async (keyring) => ({
        listing: [keepBlob(await encryptPath(keyring, ["From"]), "sha-keep")],
        changeSet: [
          { kind: "rename-folder", from: ["From"], to: ["Missing", "To"] },
        ],
      }),
    },
  ];

  it.each(invalidCases.map((c) => [c.name, c.build] as const))(
    "rejects: %s",
    async (_name, build) => {
      const keyring = await testKeyring();
      const { listing, changeSet } = await build(keyring);
      await expect(
        encodeChangeSet({ listing, changeSet, keyring }),
      ).rejects.toThrow(InvalidChangeSetError);
    },
  );
});

describe("encodeInitializeMessage", () => {
  it("equals the pinned literal", () => {
    expect(encodeInitializeMessage()).toBe(
      "commitnote: initialize\n\nCommitnote-Format: 1",
    );
  });
});
