import { describe, expect, it } from "vitest";
import {
  EMPTY_TAGS,
  parseTagIndex,
  tagKey,
  type TagIndex,
} from "../tags/tag-index";
import type { Keyring } from "../crypto/keyring";
import { decryptNote } from "../crypto/note-cipher";
import { encryptPath } from "../crypto/name-cipher";
import { testKeyring as sharedTestKeyring } from "../crypto/testing/test-keyring";
import {
  parseRepoConfig,
  serializeRepoConfig,
  type RepoConfig,
} from "../crypto/repo-config";
import type { TreeEntry } from "../forge/forge-adapter";
import { FOLDER_MARKER, ORDER_PATH, REPO_CONFIG_PATH, TAGS_PATH } from "../format/v1";
import {
  decryptOrderIndex,
  EMPTY_ORDER,
  parseOrderIndex,
  serializeOrderIndex,
  type OrderIndex,
} from "../order/order-index";
import type { EncodedChangeSet } from "./encode-change-set";
import type { ChangeSet } from "./change";
import {
  encodeChangeSet,
  encodeChangePassphraseMessage,
  encodeInitializeMessage,
  encodeUndoOutdatedSaveMessage,
  InvalidChangeSetError,
} from "./encode-change-set";

function testKeyring(): Promise<Keyring> {
  return sharedTestKeyring(undefined, 9);
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

    const result = await encodeChangeSet({ listing: [], changeSet, order: EMPTY_ORDER, tags: EMPTY_TAGS, keyring });

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

    const result = await encodeChangeSet({ listing: [], changeSet, order: EMPTY_ORDER, tags: EMPTY_TAGS, keyring });

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

    const result = await encodeChangeSet({ listing, changeSet, order: EMPTY_ORDER, tags: EMPTY_TAGS, keyring });

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

    const result = await encodeChangeSet({ listing, changeSet, order: EMPTY_ORDER, tags: EMPTY_TAGS, keyring });

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

    const result = await encodeChangeSet({ listing, changeSet, order: EMPTY_ORDER, tags: EMPTY_TAGS, keyring });

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

    const result = await encodeChangeSet({ listing, changeSet, order: EMPTY_ORDER, tags: EMPTY_TAGS, keyring });

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

    const result = await encodeChangeSet({ listing, changeSet, order: EMPTY_ORDER, tags: EMPTY_TAGS, keyring });

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

    const result = await encodeChangeSet({ listing: [], changeSet, order: EMPTY_ORDER, tags: EMPTY_TAGS, keyring });

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

    const result = await encodeChangeSet({ listing: [], changeSet, order: EMPTY_ORDER, tags: EMPTY_TAGS, keyring });

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

    const result = await encodeChangeSet({ listing, changeSet, order: EMPTY_ORDER, tags: EMPTY_TAGS, keyring });

    expect(result.message).toBe(
      `commitnote: save\n\n` +
        `Commitnote-Format: 1\n` +
        `Commitnote-Create: ${storedNewNote}\n` +
        `Commitnote-Update: ${storedToUpdate}\n` +
        `Commitnote-Delete: ${storedToDelete}\n` +
        `Commitnote-Create: ${storedNewFolder}\n` +
        `Commitnote-Rename: ${storedFrom} -> ${storedTo}`,
    );
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

    const result = await encodeChangeSet({ listing: [], changeSet, order: EMPTY_ORDER, tags: EMPTY_TAGS, keyring });

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
      encodeChangeSet({
        listing: [],
        changeSet: [],
        order: EMPTY_ORDER, tags: EMPTY_TAGS,
        keyring,
      }),
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
        encodeChangeSet({ listing, changeSet, order: EMPTY_ORDER, tags: EMPTY_TAGS, keyring }),
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

describe("encodeUndoOutdatedSaveMessage", () => {
  it("equals the pinned literal", () => {
    expect(encodeUndoOutdatedSaveMessage()).toBe(
      "commitnote: undo save with outdated passphrase\n\nCommitnote-Format: 1",
    );
  });
});

describe("encodeChangePassphraseMessage", () => {
  it("equals the pinned literal", () => {
    expect(encodeChangePassphraseMessage()).toBe(
      "commitnote: change passphrase\n\nCommitnote-Format: 1",
    );
  });
});

describe("encodeChangeSet: trash", () => {
  const ID1 = "20260101T000000Z-1-aaaaaaaa";
  const ID2 = "20260102T000000Z-2-bbbbbbbb";
  const ID3 = "20260103T000000Z-1-cccccccc";
  const trashed = (id: string, stored: string) =>
    `.commitnote/trash/${id}/${stored}`;

  it("trash-note: moves the blob into the entry dir, keeps the parent folder with a .keep, writes a Trash trailer", async () => {
    const keyring = await testKeyring();
    const folder = await encryptPath(keyring, ["Secret folder"]);
    const note = await encryptPath(keyring, ["Secret folder", "Secret note"]);
    const result = await encodeChangeSet({
      listing: [blob(note, "sha-n")],
      changeSet: [{ kind: "trash-note", path: ["Secret folder", "Secret note"], entryId: ID2 }],
      order: EMPTY_ORDER, tags: EMPTY_TAGS,
      keyring,
    });

    expect(result.changes).toEqual(
      [
        { kind: "delete", path: note },
        { kind: "upsert-blob", path: trashed(ID2, note), blobSha: "sha-n" },
        { kind: "upsert-text", path: `${folder}/${FOLDER_MARKER}`, text: "" },
      ].sort((a, b) => (a.path < b.path ? -1 : 1)),
    );
    expect(result.message).toBe(
      `commitnote: save\n\nCommitnote-Format: 1\nCommitnote-Trash: ${note} -> ${ID2}`,
    );
    const everything = result.message + result.changes.map((c) => c.path).join();
    expect(everything).not.toContain("Secret");
  });

  it("trash-folder: moves nested files and .keep by sha; no blob creation", async () => {
    const keyring = await testKeyring();
    const folder = await encryptPath(keyring, ["F"]);
    const sub = await encryptPath(keyring, ["F", "Sub"]);
    const note = await encryptPath(keyring, ["F", "Sub", "N"]);
    const listing = [
      keepBlob(folder, "sha-k1"),
      keepBlob(sub, "sha-k2"),
      blob(note, "sha-n"),
    ];
    const result = await encodeChangeSet({
      listing,
      changeSet: [{ kind: "trash-folder", path: ["F"], entryId: ID1 }],
      order: EMPTY_ORDER, tags: EMPTY_TAGS,
      keyring,
    });

    expect(result.changes.every((c) => c.kind !== "upsert-text")).toBe(true);
    expect(result.changes).toHaveLength(6);
    for (const [p, sha] of [
      [`${folder}/${FOLDER_MARKER}`, "sha-k1"],
      [`${sub}/${FOLDER_MARKER}`, "sha-k2"],
      [note, "sha-n"],
    ]) {
      expect(result.changes).toContainEqual({ kind: "delete", path: p });
      expect(result.changes).toContainEqual({
        kind: "upsert-blob",
        path: trashed(ID1, p),
        blobSha: sha,
      });
    }
    expect(result.message).toContain(`Commitnote-Trash: ${folder} -> ${ID1}`);
  });

  it("restore-trash: moves a whole entry into an existing folder", async () => {
    const keyring = await testKeyring();
    const note = await encryptPath(keyring, ["Old"]);
    const target = await encryptPath(keyring, ["Target"]);
    const to = await encryptPath(keyring, ["Target", "Renamed"]);
    const result = await encodeChangeSet({
      listing: [keepBlob(target, "sha-k"), blob(trashed(ID1, note), "sha-n")],
      changeSet: [
        { kind: "restore-trash", entryId: ID1, subPath: [], target: "note", to: ["Target", "Renamed"] },
      ],
      order: EMPTY_ORDER, tags: EMPTY_TAGS,
      keyring,
    });

    expect(result.changes).toHaveLength(2);
    expect(result.changes).toContainEqual({ kind: "delete", path: trashed(ID1, note) });
    expect(result.changes).toContainEqual({ kind: "upsert-blob", path: to, blobSha: "sha-n" });
    expect(result.message).toContain(`Commitnote-Restore: ${ID1} -> ${to}`);
  });

  it("restore-trash: rejects a missing target folder", async () => {
    const keyring = await testKeyring();
    const note = await encryptPath(keyring, ["Old"]);
    await expect(
      encodeChangeSet({
        listing: [blob(trashed(ID1, note), "sha-n")],
        changeSet: [
          { kind: "restore-trash", entryId: ID1, subPath: [], target: "note", to: ["Nope", "X"] },
        ],
        order: EMPTY_ORDER, tags: EMPTY_TAGS,
        keyring,
      }),
    ).rejects.toThrow(InvalidChangeSetError);
  });

  it("restore-trash: sub-item out of a trashed folder leaves a .keep in the remaining structure", async () => {
    const keyring = await testKeyring();
    const folder = await encryptPath(keyring, ["F"]);
    const note = await encryptPath(keyring, ["F", "Sub", "N"]);
    const result = await encodeChangeSet({
      listing: [blob(trashed(ID3, note), "sha-n")],
      changeSet: [
        {
          kind: "restore-trash",
          entryId: ID3,
          subPath: ["Sub", "N"],
          target: "note",
          to: ["Back"],
        },
      ],
      order: EMPTY_ORDER, tags: EMPTY_TAGS,
      keyring,
    });
    const back = await encryptPath(keyring, ["Back"]);
    const sub = await encryptPath(keyring, ["F", "Sub"]);

    expect(folder).toBeTruthy();
    expect(result.changes).toContainEqual({ kind: "upsert-blob", path: back, blobSha: "sha-n" });
    expect(result.changes).toContainEqual({ kind: "delete", path: trashed(ID3, note) });
    expect(result.changes).toContainEqual({
      kind: "upsert-text",
      path: trashed(ID3, `${sub}/${FOLDER_MARKER}`),
      text: "",
    });
  });

  it("restore-trash: a sub-folder moves with its contents", async () => {
    const keyring = await testKeyring();
    const a = await encryptPath(keyring, ["F", "A", "N1"]);
    const b = await encryptPath(keyring, ["F", "A", "Deep", "N2"]);
    const other = await encryptPath(keyring, ["F", "Other"]);
    const result = await encodeChangeSet({
      listing: [
        blob(trashed(ID3, a), "s1"),
        blob(trashed(ID3, b), "s2"),
        blob(trashed(ID3, other), "s3"),
      ],
      changeSet: [
        { kind: "restore-trash", entryId: ID3, subPath: ["A"], target: "folder", to: ["A2"] },
      ],
      order: EMPTY_ORDER, tags: EMPTY_TAGS,
      keyring,
    });
    expect(result.changes.filter((c) => c.kind === "upsert-blob")).toEqual([
      { kind: "upsert-blob", path: `${await encryptPath(keyring, ["A2", "Deep", "N2"])}`, blobSha: "s2" },
      { kind: "upsert-blob", path: `${await encryptPath(keyring, ["A2", "N1"])}`, blobSha: "s1" },
    ].sort((x, y) => (x.path < y.path ? -1 : 1)));
    expect(result.changes.filter((c) => c.kind === "upsert-text")).toEqual([]);
  });

  it("purge-trash: deletes everything under each id, one trailer per id, ignores unknown ids", async () => {
    const keyring = await testKeyring();
    const n1 = await encryptPath(keyring, ["A"]);
    const n2 = await encryptPath(keyring, ["F", "B"]);
    const keep = await encryptPath(keyring, ["Keep"]);
    const unknown = "20260105T000000Z-1-dddddddd";
    const result = await encodeChangeSet({
      listing: [
        blob(trashed(ID1, n1), "s1"),
        blob(trashed(ID2, n2), "s2"),
        blob(trashed(ID3, n1), "s3"),
        blob(keep, "s4"),
      ],
      changeSet: [{ kind: "purge-trash", entryIds: [ID1, ID2, unknown] }],
      order: EMPTY_ORDER, tags: EMPTY_TAGS,
      keyring,
    });

    expect(result.changes).toEqual(
      [
        { kind: "delete", path: trashed(ID1, n1) },
        { kind: "delete", path: trashed(ID2, n2) },
      ].sort((a, b) => (a.path < b.path ? -1 : 1)),
    );
    expect(result.message).toBe(
      `commitnote: save\n\nCommitnote-Format: 1\nCommitnote-Purge: ${ID1}\nCommitnote-Purge: ${ID2}\nCommitnote-Purge: ${unknown}`,
    );
  });
});

describe("encodeChangeSet: order", () => {
  type Folders = Record<string, Record<string, string>>;

  function orderOf(folders: Folders): OrderIndex {
    return parseOrderIndex(JSON.stringify({ version: 1, folders }));
  }

  async function storedFolders(
    keyring: Keyring,
    result: EncodedChangeSet,
  ): Promise<Folders | undefined> {
    const change = result.changes.find((item) => item.path === ORDER_PATH);
    if (change === undefined) return undefined;
    if (change.kind !== "upsert-text") throw new Error("expected order text");
    const index = await decryptOrderIndex(keyring, change.text);
    return JSON.parse(serializeOrderIndex(index)).folders;
  }

  const ROOT = JSON.stringify([]);
  const DOCS = JSON.stringify(["Docs"]);

  async function sampleListing(keyring: Keyring): Promise<TreeEntry[]> {
    return [
      blob(await encryptPath(keyring, ["Alpha"]), "sha-alpha"),
      blob(await encryptPath(keyring, ["Beta"]), "sha-beta"),
      keepBlob(await encryptPath(keyring, ["Docs"]), "sha-docs"),
      blob(await encryptPath(keyring, ["Docs", "Guide"]), "sha-guide"),
      keepBlob(await encryptPath(keyring, ["Docs", "Sub"]), "sha-sub"),
      blob(ORDER_PATH, "sha-order"),
    ];
  }

  const SAMPLE_ORDER = orderOf({
    [ROOT]: { Alpha: "V", Beta: "k", Docs: "F" },
    [DOCS]: { Guide: "V" },
    [JSON.stringify(["Docs", "Sub"])]: { Inner: "V" },
  });

  it("writes the positions of a set-order with one trailer per item, naming only stored paths", async () => {
    const keyring = await testKeyring();
    const result = await encodeChangeSet({
      listing: await sampleListing(keyring),
      changeSet: [
        {
          kind: "set-order",
          parent: [],
          positions: [
            { name: "Beta", key: "1" },
            { name: "Docs", key: "z" },
          ],
        },
      ],
      order: SAMPLE_ORDER,
      tags: EMPTY_TAGS,
      keyring,
    });

    expect(await storedFolders(keyring, result)).toMatchObject({
      [ROOT]: { Alpha: "V", Beta: "1", Docs: "z" },
    });
    expect(result.message).toBe(
      [
        "commitnote: save",
        "",
        "Commitnote-Format: 1",
        `Commitnote-Order: ${await encryptPath(keyring, ["Beta"])}`,
        `Commitnote-Order: ${await encryptPath(keyring, ["Docs"])}`,
      ].join("\n"),
    );
  });

  it("keeps an item's position when it is renamed in place", async () => {
    const keyring = await testKeyring();
    const result = await encodeChangeSet({
      listing: await sampleListing(keyring),
      changeSet: [{ kind: "rename-note", from: ["Beta"], to: ["Gamma"] }],
      order: SAMPLE_ORDER,
      tags: EMPTY_TAGS,
      keyring,
    });

    expect((await storedFolders(keyring, result))?.[ROOT]).toEqual({
      Alpha: "V",
      Docs: "F",
      Gamma: "k",
    });
    expect(result.message).not.toContain("Commitnote-Order");
  });

  it("drops the position of an item moved to another folder", async () => {
    const keyring = await testKeyring();
    const result = await encodeChangeSet({
      listing: await sampleListing(keyring),
      changeSet: [{ kind: "rename-note", from: ["Beta"], to: ["Docs", "Beta"] }],
      order: SAMPLE_ORDER,
      tags: EMPTY_TAGS,
      keyring,
    });

    const folders = await storedFolders(keyring, result);
    expect(folders?.[ROOT]).toEqual({ Alpha: "V", Docs: "F" });
    expect(folders?.[DOCS]).toEqual({ Guide: "V" });
  });

  it("moves the positions inside a folder along with it", async () => {
    const keyring = await testKeyring();
    const result = await encodeChangeSet({
      listing: await sampleListing(keyring),
      changeSet: [
        { kind: "create-folder", path: ["Archive"] },
        { kind: "rename-folder", from: ["Docs"], to: ["Archive", "Docs"] },
      ],
      order: SAMPLE_ORDER,
      tags: EMPTY_TAGS,
      keyring,
    });

    expect(await storedFolders(keyring, result)).toEqual({
      [ROOT]: { Alpha: "V", Beta: "k" },
      [JSON.stringify(["Archive", "Docs"])]: { Guide: "V" },
      [JSON.stringify(["Archive", "Docs", "Sub"])]: { Inner: "V" },
    });
  });

  it("drops the positions of a trashed folder and everything in it", async () => {
    const keyring = await testKeyring();
    const result = await encodeChangeSet({
      listing: await sampleListing(keyring),
      changeSet: [
        {
          kind: "trash-folder",
          path: ["Docs"],
          entryId: "20260101T000000Z-1-aaaaaaaa",
        },
      ],
      order: SAMPLE_ORDER,
      tags: EMPTY_TAGS,
      keyring,
    });

    expect(await storedFolders(keyring, result)).toEqual({
      [ROOT]: { Alpha: "V", Beta: "k" },
    });
  });

  it("leaves the order file alone when no position changes", async () => {
    const keyring = await testKeyring();
    const result = await encodeChangeSet({
      listing: await sampleListing(keyring),
      changeSet: [
        { kind: "update-note", path: ["Alpha"], content: "edited" },
        { kind: "create-note", path: ["Docs", "Sub", "New"], content: "" },
      ],
      order: SAMPLE_ORDER,
      tags: EMPTY_TAGS,
      keyring,
    });

    expect(await storedFolders(keyring, result)).toBeUndefined();
  });

  it("writes nothing for positions when the stored order can't be read", async () => {
    const keyring = await testKeyring();
    const result = await encodeChangeSet({
      listing: await sampleListing(keyring),
      changeSet: [
        {
          kind: "set-order",
          parent: [],
          positions: [{ name: "Beta", key: "1" }],
        },
        { kind: "rename-note", from: ["Alpha"], to: ["Omega"] },
      ],
      order: parseOrderIndex("unreadable"),
      tags: EMPTY_TAGS,
      keyring,
    });

    expect(await storedFolders(keyring, result)).toBeUndefined();
    expect(result.message).not.toContain("Commitnote-Order");
  });

  it("rejects a position for an item that doesn't exist", async () => {
    const keyring = await testKeyring();
    await expect(
      encodeChangeSet({
        listing: await sampleListing(keyring),
        changeSet: [
          {
            kind: "set-order",
            parent: [],
            positions: [{ name: "Missing", key: "1" }],
          },
        ],
        order: SAMPLE_ORDER,
        tags: EMPTY_TAGS,
        keyring,
      }),
    ).rejects.toThrow(InvalidChangeSetError);
  });
});

describe("encodeChangeSet: set-settings", () => {
  function configWith(settings?: unknown): RepoConfig {
    const base: RepoConfig = {
      formatVersion: 1,
      app: "commitnote",
      cipher: "AES-256-GCM",
      nameScheme: "AES-256-GCM-SIV-HMAC-SHA256/base64url",
      kdf: { algorithm: "argon2id", memoryKiB: 65536, iterations: 3, parallelism: 1, salt: Uint8Array.from({ length: 16 }, () => 5) },
      keyCheck: `${"A".repeat(43)}=`,
      createdAt: "2026-01-02T03:04:05.000Z",
    };
    return settings === undefined ? base : { ...base, settings };
  }

  function writtenConfig(result: EncodedChangeSet): RepoConfig | undefined {
    const change = result.changes.find((c) => c.path === REPO_CONFIG_PATH);
    if (change === undefined) return undefined;
    if (change.kind !== "upsert-text") throw new Error("expected plaintext");
    const parsed = parseRepoConfig(change.text);
    if (parsed.kind !== "valid") throw new Error(parsed.kind);
    return parsed.config;
  }

  async function encode(
    changeSet: ChangeSet,
    config: RepoConfig | undefined,
    listing: TreeEntry[] = [],
  ): Promise<EncodedChangeSet> {
    return encodeChangeSet({
      listing,
      changeSet,
      order: EMPTY_ORDER, tags: EMPTY_TAGS,
      keyring: await testKeyring(),
      config,
    });
  }

  it("writes the edit into plaintext config.json, keeps crypto fields and adds one trailer per key", async () => {
    const config = configWith();
    const result = await encode(
      [{ kind: "set-settings", values: { theme: "dark" } }],
      config,
      [blob(REPO_CONFIG_PATH, "sha-config")],
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].kind).toBe("upsert-text");
    const written = writtenConfig(result);
    expect(written).toEqual({ ...config, settings: { theme: "dark" } });
    expect(result.message).toContain("Commitnote-Settings: theme");
  });

  it("preserves existing unknown settings", async () => {
    const result = await encode(
      [{ kind: "set-settings", values: { theme: "dark" } }],
      configWith({ future: { a: 1 }, theme: "light" }),
    );

    expect(writtenConfig(result)?.settings).toEqual({
      future: { a: 1 },
      theme: "dark",
    });
  });

  it("merges several set-settings changes with the later value winning, in one write", async () => {
    const result = await encode(
      [
        { kind: "set-settings", values: { theme: "dark", size: 1 } },
        { kind: "set-settings", values: { theme: "light" } },
      ],
      configWith(),
    );

    expect(result.changes).toHaveLength(1);
    expect(writtenConfig(result)?.settings).toEqual({ theme: "light", size: 1 });
    expect(result.message).toContain("Commitnote-Settings: size\nCommitnote-Settings: theme");
  });

  it("writes nothing and adds no trailer when the edit equals the stored value", async () => {
    const result = await encode(
      [{ kind: "set-settings", values: { theme: "dark" } }],
      configWith({ theme: "dark" }),
    );

    expect(result.changes).toEqual([]);
    expect(result.message).not.toContain("Commitnote-Settings");
  });

  it("writes both a note change and the settings change from one change set", async () => {
    const keyring = await testKeyring();
    const storedNote = await encryptPath(keyring, ["Note"]);
    const result = await encode(
      [
        { kind: "create-note", path: ["Note"], content: "hi" },
        { kind: "set-settings", values: { theme: "dark" } },
      ],
      configWith(),
    );

    expect(result.changes.map((c) => c.path).sort()).toEqual(
      [REPO_CONFIG_PATH, storedNote].sort(),
    );
    expect(result.message).toContain(`Commitnote-Create: ${storedNote}`);
    expect(result.message).toContain("Commitnote-Settings: theme");
  });

  it("rejects a set-settings change when no config is given", async () => {
    await expect(
      encode([{ kind: "set-settings", values: { theme: "dark" } }], undefined),
    ).rejects.toThrow(InvalidChangeSetError);
  });

  it("rejects a set-settings change without values", async () => {
    await expect(
      encode([{ kind: "set-settings", values: {} }], configWith()),
    ).rejects.toThrow(InvalidChangeSetError);
  });

  it("never puts a setting value in the message", async () => {
    const result = await encode(
      [{ kind: "set-settings", values: { theme: "very-secret-value" } }],
      configWith(),
    );

    expect(result.message).not.toContain("very-secret-value");
  });

  it("serializes the written config exactly as serializeRepoConfig does", async () => {
    const config = configWith();
    const result = await encode(
      [{ kind: "set-settings", values: { theme: "dark" } }],
      config,
    );

    expect(result.changes[0]).toEqual({
      kind: "upsert-text",
      path: REPO_CONFIG_PATH,
      text: serializeRepoConfig({ ...config, settings: { theme: "dark" } }),
    });
  });
});

describe("encodeChangeSet: color tags", () => {
  const TAGGED: TagIndex = parseTagIndex(
    JSON.stringify({
      version: 1,
      notes: { [tagKey(["Alpha"])]: { color: "red" } },
      trash: {},
    }),
  );

  async function setup() {
    const keyring = await testKeyring();
    const alpha = await encryptPath(keyring, ["Alpha"]);
    const beta = await encryptPath(keyring, ["Beta"]);
    const listing = [blob(alpha, "sha-a"), blob(beta, "sha-b")];
    return { keyring, listing };
  }

  async function writtenTags(
    keyring: Keyring,
    result: EncodedChangeSet,
  ): Promise<TagIndex | undefined> {
    const change = result.changes.find((c) => c.path === TAGS_PATH);
    if (change === undefined) return undefined;
    if (change.kind !== "upsert-text") throw new Error("expected text");
    return parseTagIndex(await decryptText(keyring, change.text));
  }

  it("writes only an encrypted tags upsert for a set-color-tag", async () => {
    const { keyring, listing } = await setup();
    const result = await encodeChangeSet({
      listing,
      changeSet: [{ kind: "set-color-tag", path: ["Beta"], color: "blue" }],
      order: EMPTY_ORDER,
      tags: TAGGED,
      keyring,
    });

    expect(result.changes.map((c) => c.path)).toEqual([TAGS_PATH]);
    const written = await writtenTags(keyring, result);
    expect(written?.notes.get(tagKey(["Beta"]))).toEqual({ color: "blue" });
    expect(written?.notes.get(tagKey(["Alpha"]))).toEqual({ color: "red" });
  });

  it("commits a rename of a tagged note together with the updated tags", async () => {
    const { keyring, listing } = await setup();
    const result = await encodeChangeSet({
      listing,
      changeSet: [{ kind: "rename-note", from: ["Alpha"], to: ["Gamma"] }],
      order: EMPTY_ORDER,
      tags: TAGGED,
      keyring,
    });

    const written = await writtenTags(keyring, result);
    expect(written?.notes.has(tagKey(["Alpha"]))).toBe(false);
    expect(written?.notes.get(tagKey(["Gamma"]))).toEqual({ color: "red" });
    expect(result.changes.length).toBeGreaterThan(1);
  });

  it("leaves the tags file alone when renaming an untagged note", async () => {
    const { keyring, listing } = await setup();
    const result = await encodeChangeSet({
      listing,
      changeSet: [{ kind: "rename-note", from: ["Beta"], to: ["Gamma"] }],
      order: EMPTY_ORDER,
      tags: TAGGED,
      keyring,
    });

    expect(result.changes.some((c) => c.path === TAGS_PATH)).toBe(false);
  });

  it("leaves the tags file alone when the tag already has that value", async () => {
    const { keyring, listing } = await setup();
    const result = await encodeChangeSet({
      listing,
      changeSet: [
        { kind: "set-color-tag", path: ["Alpha"], color: "red" },
        { kind: "set-color-tag", path: ["Beta"], color: null },
      ],
      order: EMPTY_ORDER,
      tags: TAGGED,
      keyring,
    });

    expect(result.changes).toEqual([]);
  });

  it("adds no tag data and no trailer to the commit message", async () => {
    const { keyring, listing } = await setup();
    const withTag = await encodeChangeSet({
      listing,
      changeSet: [
        { kind: "set-color-tag", path: ["Alpha"], color: "green" },
        { kind: "update-note", path: ["Beta"], content: "x" },
      ],
      order: EMPTY_ORDER,
      tags: TAGGED,
      keyring,
    });
    const without = await encodeChangeSet({
      listing,
      changeSet: [{ kind: "update-note", path: ["Beta"], content: "x" }],
      order: EMPTY_ORDER,
      tags: TAGGED,
      keyring,
    });

    expect(withTag.message).toBe(without.message);
    expect(withTag.message).not.toContain("green");
  });

  it("never writes an unreadable tag index", async () => {
    const { keyring, listing } = await setup();
    const unreadable = parseTagIndex("unreadable");
    expect(unreadable.writable).toBe(false);
    const result = await encodeChangeSet({
      listing,
      changeSet: [
        { kind: "set-color-tag", path: ["Beta"], color: "blue" },
        { kind: "rename-note", from: ["Alpha"], to: ["Gamma"] },
      ],
      order: EMPTY_ORDER,
      tags: unreadable,
      keyring,
    });

    expect(result.changes.some((c) => c.path === TAGS_PATH)).toBe(false);
  });

  it("rejects set-color-tag for a path that is not a note", async () => {
    const { keyring, listing } = await setup();
    await expect(
      encodeChangeSet({
        listing,
        changeSet: [{ kind: "set-color-tag", path: ["Missing"], color: "red" }],
        order: EMPTY_ORDER,
        tags: EMPTY_TAGS,
        keyring,
      }),
    ).rejects.toThrow(InvalidChangeSetError);
  });
});
