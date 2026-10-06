import { describe, expect, it } from "vitest";
import { EMPTY_TAGS } from "../tags/tag-index";
import { encryptPath } from "../crypto/name-cipher";
import { CHANGE_PASSPHRASE_SUBJECT, SAVE_SUBJECT, TRAILER } from "../format/v1";
import { EMPTY_ORDER } from "../order/order-index";
import { newRepoConfig } from "../rekey/testing/rekey-fixture";
import { parseCommitMessage } from "./commit-message";
import {
  encodeChangePassphraseMessage,
  encodeChangeSet,
} from "./encode-change-set";

describe("parseCommitMessage", () => {
  it("reads back the subject, format and trailers encodeChangeSet wrote, in order", async () => {
    const { keyring } = await newRepoConfig("passphrase");
    const a = await encryptPath(keyring, ["A"]);
    const b = await encryptPath(keyring, ["B"]);

    const { message } = await encodeChangeSet({
      listing: [],
      changeSet: [
        { kind: "create-note", path: ["A"], content: "x" },
        { kind: "rename-note", from: ["A"], to: ["B"] },
        { kind: "update-note", path: ["B"], content: "y" },
      ],
      order: EMPTY_ORDER, tags: EMPTY_TAGS,
      keyring,
    });

    expect(parseCommitMessage(message)).toEqual({
      subject: SAVE_SUBJECT,
      formatVersion: 1,
      trailers: [
        { key: TRAILER.create, value: a },
        { key: TRAILER.rename, value: `${a} -> ${b}` },
        { key: TRAILER.update, value: b },
      ],
    });
  });

  it("reads a passphrase change as its subject with no trailers", () => {
    expect(parseCommitMessage(encodeChangePassphraseMessage())).toEqual({
      subject: CHANGE_PASSPHRASE_SUBJECT,
      formatVersion: 1,
      trailers: [],
    });
  });

  it.each([
    ["a subject only", "Fix typo"],
    ["a body without trailers", "Fix typo\n\nSome explanation.\n"],
  ])("gives no format version for a foreign message with %s", (_, message) => {
    expect(parseCommitMessage(message)).toEqual({
      subject: "Fix typo",
      formatVersion: null,
      trailers: [],
    });
  });

  it("reads only the last paragraph as trailers", () => {
    const message =
      "Edit\r\n\r\nNote: not a trailer\r\n\r\nCommitnote-Format: 1\r\nCommitnote-Update: abc\r\n";

    expect(parseCommitMessage(message)).toEqual({
      subject: "Edit",
      formatVersion: 1,
      trailers: [{ key: TRAILER.update, value: "abc" }],
    });
  });
});
