import { describe, expect, it } from "vitest";
import { encryptPath } from "../crypto/name-cipher";
import { encryptNote } from "../crypto/note-cipher";
import {
  createRekeyFixture,
  type RekeyFixture,
} from "../rekey/testing/rekey-fixture";
import { createTestClock } from "./testing/test-clock";
import { createSyncEngine } from "./sync-engine";

async function setup() {
  const fixture = await createRekeyFixture();
  const clock = createTestClock(1_000_000);
  const engine = createSyncEngine({
    adapter: fixture.adapter,
    keyring: fixture.oldKeyring,
    clock,
  });
  await engine.refresh();
  return { fixture, clock, engine };
}

async function pushWelcome(fixture: RekeyFixture, text: string): Promise<void> {
  await fixture.adapter.pushFromAnotherDevice([
    {
      kind: "upsert-text",
      path: await encryptPath(fixture.oldKeyring, ["Welcome"]),
      text: await encryptNote(fixture.oldKeyring, text),
    },
  ]);
}

describe("sync engine suspend", () => {
  it("refuses changes, saves and refreshes while suspended", async () => {
    const { fixture, clock, engine } = await setup();
    const head = await fixture.adapter.getHead();

    expect(engine.suspend()).toBe(true);
    expect(engine.getState().suspended).toBe(true);
    engine.editNote(["Welcome"], "typed while suspended");
    expect(engine.createNote([], "New").ok).toBe(false);
    expect(engine.createFolder([], "New").ok).toBe(false);
    expect(engine.rename(["Welcome"], "Renamed").ok).toBe(false);
    expect(engine.move(["Welcome"], ["Archive"]).ok).toBe(false);
    expect(engine.delete(["Welcome"]).ok).toBe(false);
    engine.emptyTrash();
    await pushWelcome(fixture, "from another device");
    await engine.refresh();
    clock.advance(10 * 60_000);
    expect(await engine.flush()).toEqual({ kind: "saved" });

    const state = engine.getState();
    expect(state.pending).toEqual([]);
    expect(state.synced?.head).toBe(head);
    expect(await fixture.adapter.getHead()).not.toBe(head);
  });

  it("works normally again after resume", async () => {
    const { fixture, engine } = await setup();
    engine.suspend();

    engine.resume();
    engine.editNote(["Welcome"], "typed after resume");
    expect(await engine.flush()).toEqual({ kind: "saved" });

    expect(engine.getState().suspended).toBe(false);
    expect(await fixture.adapter.getHead()).toBe(
      engine.getState().synced?.head,
    );
    expect(engine.getState().synced?.head).not.toBe(fixture.head);
  });

  it("is refused while a change is unsaved", async () => {
    const { engine } = await setup();
    engine.editNote(["Welcome"], "unsaved");

    expect(engine.suspend()).toBe(false);
    expect(engine.getState().suspended).toBe(false);
  });

  it("is refused before the tree has loaded", () => {
    const engine = createSyncEngine({
      adapter: {
        limits: { perMinute: 1, perHour: 1 },
        commitCost: () => 1,
        inspect: () => Promise.reject(new Error()),
        initialize: () => Promise.reject(new Error()),
        getHead: () => Promise.reject(new Error()),
        listTree: () => Promise.reject(new Error()),
        listCommits: () => Promise.reject(new Error()),
        findOldestCommit: () => Promise.reject(new Error()),
        readFileAt: () => Promise.reject(new Error()),
        readBlob: () => Promise.reject(new Error()),
        commit: () => Promise.reject(new Error()),
        shareHost: {
          create: () => Promise.reject(new Error()),
          delete: () => Promise.reject(new Error()),
        },
      },
      keyring: undefined as never,
      clock: createTestClock(0),
    });

    expect(engine.suspend()).toBe(false);
  });
});
