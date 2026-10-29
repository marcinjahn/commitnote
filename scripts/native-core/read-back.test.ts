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
const WELCOME = ["Welcome"];
const POLISH = ["Zażółć gęślą jaźń"];
const IDEAS = ["Projects", "commitnote", "Ideas"];
const notePath = [
  sampleNotesRepoSource.find((entry) => entry.kind === "note")!.name,
];

let scenario: ReadBackScenario;
let organised: ReadBackScenario;

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

  const organiseAdapter = await createSampleNotesRepoAdapter();
  const organiseEngine = createSyncEngine({
    adapter: organiseAdapter,
    keyring: await sampleNotesRepoKeyring(),
    clock: createTestClock(Date.now()),
    deviceName: () => DEVICE,
  });
  await organiseEngine.refresh();
  organiseEngine.place(POLISH, { parent: [], before: "Welcome" });
  organiseEngine.setColorTag(WELCOME, "red");
  organiseEngine.delete(IDEAS);
  const organiseFlushed = await organiseEngine.flush();
  organiseEngine.dispose();
  if (organiseFlushed.kind !== "saved") {
    throw new Error(`save failed: ${organiseFlushed.kind}`);
  }
  organised = {
    name: "organise",
    passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
    exported: JSON.stringify({
      objects: organiseAdapter.repo.exportObjects(),
      main: organiseAdapter.repo.getRef(MAIN_BRANCH) ?? null,
    }),
    expect: {
      initialized: false,
      notes: [],
      deviceName: DEVICE,
      order: [{ parent: [], names: ["Empty folder", "Journal", "Projects", POLISH[0]!, "Welcome"] }],
      tags: [
        { path: WELCOME, tag: "red" },
        { path: POLISH, tag: "purple" },
      ],
      trash: { count: 1, names: ["Ideas"] },
    },
  };

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

  it("checks that expected folders exist as folders", async () => {
    expect(await readBack({ folders: [["Journal", "2026"], ["Projects"]] })).toEqual(
      [],
    );
    expect(
      await readBack({
        folders: [["Nowhere"], notePath, ["Journal", "2026"]],
      }),
    ).toEqual([
      "save: expected folder 1 is not in the head tree",
      "save: expected folder 2 is not in the head tree",
    ]);
  });

  it("reads back order, tags and trash from an organised repo", async () => {
    expect(
      await readBackNativeRepo(organised, { argon2id: sharedMemoizedArgon2id }),
    ).toEqual([]);
  });

  it("fails each organisation check without naming anything", async () => {
    const failures = await readBackNativeRepo(
      {
        ...organised,
        expect: {
          ...organised.expect,
          order: [
            { parent: [], names: ["Welcome", POLISH[0]!, "Projects", "Journal", "Empty folder"] },
            { parent: ["Nowhere"], names: [] },
          ],
          tags: [{ path: WELCOME, tag: "blue" }],
          trash: { count: 1, names: ["Something else"] },
        },
      },
      { argon2id: sharedMemoizedArgon2id },
    );

    expect(failures).toEqual([
      "organise: expected order 1 lists the siblings in a different order",
      "organise: expected order 2 names a folder that is not in the head tree",
      "organise: expected tag 1 differs",
      "organise: the trash holds differently named entries",
    ]);
    expect(
      await readBackNativeRepo(
        {
          ...organised,
          expect: { ...organised.expect, trash: { count: 2, names: [] } },
        },
        { argon2id: sharedMemoizedArgon2id },
      ),
    ).toEqual(["organise: the trash holds a different number of entries"]);
  });
});
