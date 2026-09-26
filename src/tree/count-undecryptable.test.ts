import { describe, expect, it } from "vitest";
import { encryptPath } from "../crypto/name-cipher";
import { encryptNote } from "../crypto/note-cipher";
import {
  createRekeyFixture,
  newRepoConfig,
} from "../rekey/testing/rekey-fixture";
import { countUndecryptableFiles } from "./note-tree";

describe("countUndecryptableFiles", () => {
  it("counts notes and folders whose names were encrypted with another key", async () => {
    const other = (await newRepoConfig("another key")).keyring;
    const fixture = await createRekeyFixture({
      extraFiles: async () => ({
        [await encryptPath(other, ["Elsewhere"])]: await encryptNote(other, "x"),
        [`${await encryptPath(other, ["Folder"])}/.keep`]: "",
        "notes/plain.md": "plaintext",
      }),
    });

    const count = await countUndecryptableFiles(
      await fixture.adapter.listTree(fixture.head),
      fixture.oldKeyring,
    );

    expect(count).toBe(2);
  });
});
