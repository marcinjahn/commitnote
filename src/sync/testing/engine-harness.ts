import { expect, vi } from "vitest";
import type { ChangeSet, NotePath } from "../../changes/change";
import {
  encodeChangeSet,
} from "../../changes/encode-change-set";
import type { Keyring } from "../../crypto/keyring";
import { decryptNote } from "../../crypto/note-cipher";
import type { FakeForgeAdapter } from "../../forge/fake/fake-forge-adapter";
import { GITHUB_WRITE_LIMITS } from "../../forge/github/github-adapter";
import { readOrderIndex } from "../../order/order-index";
import { readTagIndex } from "../../tags/tag-index";
import { sampleNotesRepoKeyring } from "../../testing/sample-notes-repo/sample-notes-repo-keyring";
import { buildNoteTree, findNode, type NoteTree } from "../../tree/note-tree";
import { createRateBudget, type RateBudget } from "../rate-budget";
import type { SyncEngine } from "../sync-engine";
import type { createTestClock } from "./test-clock";

export const WELCOME: NotePath = ["Welcome"];
export const IDEAS: NotePath = ["Projects", "commitnote", "Ideas"];
export const ZAZOLC: NotePath = ["Zażółć gęślą jaźń"];

type TestClock = ReturnType<typeof createTestClock>;

export async function settle(engine: SyncEngine): Promise<void> {
  await vi.waitFor(
    () => {
      const state = engine.getState();
      expect(state.save.kind).not.toBe("saving");
      expect(state.refresh.inFlight).toBe(false);
    },
    { timeout: 5_000, interval: 2 },
  );
}

export async function waitIdle(engine: SyncEngine): Promise<void> {
  await vi.waitFor(
    () => {
      expect(engine.getState().save.kind).not.toBe("saving");
    },
    { timeout: 5_000, interval: 2 },
  );
}

export async function advance(
  h: { readonly clock: TestClock; readonly engine: SyncEngine },
  ms: number,
): Promise<void> {
  h.clock.advance(ms);
  await settle(h.engine);
}

export async function drainAsync(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

export function okCommitCount(fake: FakeForgeAdapter, since: string): number {
  let count = 0;
  let current: string | null | undefined = fake.repo.getRef("main");
  while (current !== since && current != null) {
    count++;
    current = fake.repo.getCommit(current)?.parent;
  }
  return count;
}

export async function mainTree(
  fake: FakeForgeAdapter,
  keyring?: Keyring,
): Promise<NoteTree> {
  return buildNoteTree(
    await fake.listTree(await fake.getHead()),
    keyring ?? (await sampleNotesRepoKeyring()),
  );
}

export async function mainContent(
  fake: FakeForgeAdapter,
  path: NotePath,
  keyring?: Keyring,
): Promise<string | undefined> {
  const withKeyring = keyring ?? (await sampleNotesRepoKeyring());
  const node = findNode(await mainTree(fake, withKeyring), path);
  if (node?.kind !== "note") return undefined;
  return decryptNote(withKeyring, await fake.readBlob(node.blobSha));
}

export async function pushRemote(
  fake: FakeForgeAdapter,
  changeSet: ChangeSet,
): Promise<string> {
  const keyring = await sampleNotesRepoKeyring();
  const listing = await fake.listTree(await fake.getHead());
  const order = await readOrderIndex(listing, keyring, (sha) =>
    fake.readBlob(sha),
  );
  const tags = await readTagIndex(listing, keyring, (sha) =>
    fake.readBlob(sha),
  );
  const encoded = await encodeChangeSet({
    listing,
    changeSet,
    order,
    tags,
    keyring,
  });
  return fake.pushFromAnotherDevice(encoded.changes, encoded.message);
}

export function fullBudget(clock: TestClock): RateBudget {
  const budget = createRateBudget(clock, GITHUB_WRITE_LIMITS);
  for (let index = 0; index < GITHUB_WRITE_LIMITS.perMinute; index++) {
    budget.record();
  }
  return budget;
}
