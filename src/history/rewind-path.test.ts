import { describe, expect, it } from "vitest";
import type { ParsedCommitMessage } from "../changes/commit-message";
import {
  CHANGE_PASSPHRASE_SUBJECT,
  SAVE_SUBJECT,
  TRASH_DIR,
  TRAILER,
} from "../format/v1";
import { rewindPath, type RewindStep } from "./rewind-path";

const ID = "20260901T000000Z-1-aaaaaaaa";

function save(
  ...trailers: [key: string, value: string][]
): ParsedCommitMessage {
  return {
    subject: SAVE_SUBJECT,
    formatVersion: 1,
    trailers: trailers.map(([key, value]) => ({ key, value })),
  };
}

describe("rewindPath", () => {
  const cases: [string, ParsedCommitMessage, string, RewindStep][] = [
    [
      "an edit",
      save([TRAILER.update, "f/n"]),
      "f/n",
      { kind: "same", external: false },
    ],
    [
      "an edit of another note",
      save([TRAILER.update, "f/m"]),
      "f/n",
      { kind: "same", external: true },
    ],
    [
      "a foreign commit",
      { subject: "Fix typo", formatVersion: null, trailers: [] },
      "f/n",
      { kind: "same", external: true },
    ],
    [
      "a rename",
      save([TRAILER.rename, "f/old -> f/n"]),
      "f/n",
      { kind: "moved", before: "f/old", renamed: true, moved: false },
    ],
    [
      "a move",
      save([TRAILER.rename, "g/n -> f/n"]),
      "f/n",
      { kind: "moved", before: "g/n", renamed: false, moved: true },
    ],
    [
      "a rename of an ancestor folder",
      save([TRAILER.rename, "a/old -> a/f"]),
      "a/f/n",
      { kind: "moved", before: "a/old/n", renamed: false, moved: true },
    ],
    [
      "a rename of a sibling sharing a name prefix",
      save([TRAILER.rename, "x -> f/nn"]),
      "f/n",
      { kind: "same", external: true },
    ],
    [
      "trashing the note",
      save([TRAILER.trash, `f/n -> ${ID}`]),
      `${TRASH_DIR}/${ID}/f/n`,
      { kind: "trashed", before: "f/n" },
    ],
    [
      "trashing its folder",
      save([TRAILER.trash, `f -> ${ID}`]),
      `${TRASH_DIR}/${ID}/f/n`,
      { kind: "trashed", before: "f/n" },
    ],
    ["its creation", save([TRAILER.create, "f/n"]), "f/n", { kind: "created" }],
    [
      "a creation followed by a rename",
      save([TRAILER.create, "f/a"], [TRAILER.rename, "f/a -> f/n"]),
      "f/n",
      { kind: "created" },
    ],
    [
      "an edit followed by a rename and a move of its folder",
      save(
        [TRAILER.update, "f/a"],
        [TRAILER.rename, "f/a -> f/n"],
        [TRAILER.rename, "f -> g"],
      ),
      "g/n",
      { kind: "moved", before: "f/a", renamed: true, moved: true },
    ],
    [
      "a deletion of its folder",
      save([TRAILER.delete, "f"]),
      "f/n",
      { kind: "deleted" },
    ],
    [
      "a passphrase change",
      { subject: CHANGE_PASSPHRASE_SUBJECT, formatVersion: 1, trailers: [] },
      "f/n",
      { kind: "passphraseChanged" },
    ],
  ];

  it.each(cases)("rewinds through %s", (_, parsed, after, expected) => {
    expect(rewindPath(parsed, after)).toEqual(expected);
  });

  it("stops at a restore with the trailers applied before it", () => {
    const parsed = save(
      [TRAILER.update, "x"],
      [TRAILER.restore, `${ID} -> f`],
      [TRAILER.rename, "f/a -> f/n"],
    );

    expect(rewindPath(parsed, "f/n")).toEqual({
      kind: "restored",
      entryId: ID,
      to: "f",
      path: "f/a",
      earlier: [{ key: TRAILER.update, value: "x" }],
    });
  });
});
