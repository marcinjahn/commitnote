import { describe, expect, it } from "vitest";
import { encryptPath } from "../crypto/name-cipher";
import type { CommitRequest } from "../forge/forge-adapter";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import { FOLDER_MARKER } from "../format/v1";
import { createRekeyFixture } from "../rekey/testing/rekey-fixture";
import { createTestClock } from "./testing/test-clock";
import { createSyncEngine } from "./sync-engine";

describe("sync engine commits", () => {
  it("name files stored under the session key, folder markers first", async () => {
    const fixture = await createRekeyFixture();
    const commits: CommitRequest[] = [];
    const fake = fixture.adapter;
    const adapter = delegateAdapter(fake, {
      commit: (request) => {
        commits.push(request);
        return fake.commit(request);
      },
    });
    const engine = createSyncEngine({
      adapter,
      keyring: fixture.oldKeyring,
      clock: createTestClock(0),
    });
    await engine.refresh();

    engine.createFolder([], "New");
    await engine.flush();

    const listing = await fake.listTree(fixture.head);
    const shaOf = (path: string) =>
      listing.find((entry) => entry.path === path)?.sha;
    const files = commits[0].keyBoundFiles ?? [];
    const archiveMarker = `${await encryptPath(fixture.oldKeyring, ["Archive"])}/${FOLDER_MARKER}`;
    const welcome = await encryptPath(fixture.oldKeyring, ["Welcome"]);
    expect(files[0].path.endsWith(`/${FOLDER_MARKER}`)).toBe(true);
    expect(files).toContainEqual({
      path: archiveMarker,
      blobSha: shaOf(archiveMarker),
    });
    expect(files).toContainEqual({ path: welcome, blobSha: shaOf(welcome) });
    expect(files.every((file) => !file.path.startsWith(".commitnote/"))).toBe(
      true,
    );
    expect(files.some((file) => file.path === "README.md")).toBe(false);
  });
});
