import { beforeAll, describe, expect, it } from "vitest";
import { sharedMemoizedArgon2id } from "../../src/crypto/testing/shared-argon2id";
import { MAIN_BRANCH } from "../../src/format/v1";
import { createSyncEngine } from "../../src/sync/sync-engine";
import { createTestClock } from "../../src/sync/testing/test-clock";
import { sampleNotesRepoKeyring } from "../../src/testing/sample-notes-repo/sample-notes-repo-keyring";
import {
  SAMPLE_NOTES_REPO_PASSPHRASE,
  sampleNotesRepoSource,
} from "../../src/testing/sample-notes-repo/sample-source";
import { createSampleNotesRepoAdapter } from "../../src/testing/sample-notes-repo/seed-sample-notes-repo";
import { readBackNativeRepo, type ReadBackScenario } from "./read-back";

const DEVICE = "Read-back device";
const EDITED_TEXT = "# Edited\n\nZażółć gęślą jaźń\n";
const notePath = [
  sampleNotesRepoSource.find((entry) => entry.kind === "note")!.name,
];

let scenario: ReadBackScenario;

beforeAll(async () => {
  const adapter = await createSampleNotesRepoAdapter();
  const engine = createSyncEngine({
    adapter,
    keyring: await sampleNotesRepoKeyring(),
    clock: createTestClock(Date.now()),
    deviceName: () => DEVICE,
  });
  await engine.refresh();
  engine.editNote(notePath, EDITED_TEXT);
  const flushed = await engine.flush();
  engine.dispose();
  if (flushed.kind !== "saved") throw new Error(`save failed: ${flushed.kind}`);

  scenario = {
    name: "save",
    passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
    exported: JSON.stringify({
      objects: adapter.repo.exportObjects(),
      main: adapter.repo.getRef(MAIN_BRANCH) ?? null,
    }),
    expect: {
      initialized: false,
      notes: [{ path: notePath, text: EDITED_TEXT }],
      deviceName: DEVICE,
    },
  };
});

function readBack(changes: Partial<ReadBackScenario["expect"]> = {}) {
  return readBackNativeRepo(
    { ...scenario, expect: { ...scenario.expect, ...changes } },
    { argon2id: sharedMemoizedArgon2id },
  );
}

describe("readBackNativeRepo", () => {
  it("passes on a repo saved through the sync engine", async () => {
    expect(await readBack()).toEqual([]);
  });

  it("fails without naming the note when the expected text differs", async () => {
    const failures = await readBack({
      notes: [{ path: notePath, text: "Other text" }],
    });

    expect(failures).toEqual(["save: expected note 1 has different text"]);
    expect(failures.join()).not.toContain(notePath[0]);
  });

  it("fails when the head commit names a different device", async () => {
    expect(await readBack({ deviceName: "Another device" })).toEqual([
      "save: the head commit's device trailer names a different device",
    ]);
  });

  it("fails when the repo was expected to be initialized by this device", async () => {
    expect(await readBack({ initialized: true })).toEqual([
      "save: the initialize commit was written by a different device",
    ]);
  });
});
