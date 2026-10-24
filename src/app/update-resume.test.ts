import { beforeAll, describe, expect, it } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { testKeyring } from "../crypto/testing/test-keyring";
import type { StorageLike } from "../session/session-store";
import {
  saveUpdateResume,
  takeUpdateResume,
  UPDATE_RESUME_KEY,
  UPDATE_RESUME_MAX_AGE_MS,
  type UpdateResume,
} from "./update-resume";

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const RESUME: UpdateResume = {
  folders: [["Projects"], ["Projects", "Secret plans"]],
  notePosition: { anchor: 12, head: 20, scrollTop: 480 },
  treeScrollTop: 64,
};

let keyring: Keyring;
beforeAll(async () => {
  keyring = await testKeyring();
});

describe("update resume", () => {
  it("round-trips the view once and keeps folder names out of storage", async () => {
    const storage = new MemoryStorage();
    await saveUpdateResume(storage, { keyring, repoKey: "repo", now: 1000, resume: RESUME });
    expect(storage.getItem(UPDATE_RESUME_KEY)).not.toContain("Secret plans");
    expect(storage.getItem(UPDATE_RESUME_KEY)).not.toContain("Projects");

    expect(await takeUpdateResume(storage, { keyring, repoKey: "repo", now: 2000 })).toEqual(RESUME);
    expect(await takeUpdateResume(storage, { keyring, repoKey: "repo", now: 2000 })).toBeNull();
  });

  it("is ignored for another repository and discarded", async () => {
    const storage = new MemoryStorage();
    await saveUpdateResume(storage, { keyring, repoKey: "repo", now: 1000, resume: RESUME });
    expect(await takeUpdateResume(storage, { keyring, repoKey: "other", now: 1000 })).toBeNull();
    expect(storage.getItem(UPDATE_RESUME_KEY)).toBeNull();
  });

  it("expires", async () => {
    const storage = new MemoryStorage();
    await saveUpdateResume(storage, { keyring, repoKey: "repo", now: 1000, resume: RESUME });
    expect(
      await takeUpdateResume(storage, {
        keyring,
        repoKey: "repo",
        now: 1001 + UPDATE_RESUME_MAX_AGE_MS,
      }),
    ).toBeNull();
  });

  it("tolerates malformed records", async () => {
    const storage = new MemoryStorage();
    storage.setItem(UPDATE_RESUME_KEY, "{not json");
    expect(await takeUpdateResume(storage, { keyring, repoKey: "repo", now: 0 })).toBeNull();
    storage.setItem(
      UPDATE_RESUME_KEY,
      JSON.stringify({
        version: 1,
        repoKey: "repo",
        savedAt: 0,
        folders: [42, "not-a-real-path"],
        notePosition: { anchor: -1, head: 0, scrollTop: 0 },
        treeScrollTop: "high",
      }),
    );
    expect(await takeUpdateResume(storage, { keyring, repoKey: "repo", now: 0 })).toEqual({
      folders: [],
      notePosition: null,
      treeScrollTop: null,
    });
  });
});
