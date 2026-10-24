import { expect, vi } from "vitest";
import type { ChangeSet, NotePath } from "../../changes/change";
import {
  encodeChangeSet,
} from "../../changes/encode-change-set";
import type { Keyring } from "../../crypto/keyring";
import { decryptNote } from "../../crypto/note-cipher";
import type { FakeForgeAdapter } from "../../forge/fake/fake-forge-adapter";
import { GITHUB_WRITE_LIMITS } from "../../forge/github/github-adapter";
import type { ImageId } from "../../images/image-id";
import {
  readImageIndex,
  type AvailableImage,
} from "../../images/image-index";
import { readOrderIndex } from "../../order/order-index";
import { readShareIndex } from "../../share/share-index";
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
  deviceName?: string,
  options?: {
    now?: number;
    available?: ReadonlyMap<ImageId, AvailableImage>;
  },
): Promise<string> {
  const keyring = await sampleNotesRepoKeyring();
  const listing = await fake.listTree(await fake.getHead());
  const order = await readOrderIndex(listing, keyring, (sha) =>
    fake.readBlob(sha),
  );
  const tags = await readTagIndex(listing, keyring, (sha) =>
    fake.readBlob(sha),
  );
  const shares = await readShareIndex(listing, keyring, (sha) =>
    fake.readBlob(sha),
  );
  const images = await readImageIndex(listing, keyring, (sha) =>
    fake.readBlob(sha),
  );
  const encoded = await encodeChangeSet({
    listing,
    changeSet,
    order,
    tags,
    shares,
    images,
    keyring,
    device: deviceName ?? null,
    now: options?.now,
    available: options?.available,
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

export async function welcomeText(fake: FakeForgeAdapter): Promise<string> {
  const text = await mainContent(fake, WELCOME);
  if (text === undefined) throw new Error("expected Welcome");
  return text;
}

export function replaceLine(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`missing line ${from}`);
  return text.replace(from, to);
}

// Leaves a held conflict on Welcome: mine and theirs both rewrite its title.
export async function heldWelcomeConflict(
  h: { readonly fake: FakeForgeAdapter; readonly engine: SyncEngine },
  remoteDeviceName?: string,
): Promise<{
  readonly mine: string;
  readonly theirs: string;
  readonly remoteHead: string;
}> {
  const original = await welcomeText(h.fake);
  const mine = replaceLine(original, "# Welcome", "# Welcome (mine)");
  const theirs = replaceLine(original, "# Welcome", "# Welcome (theirs)");
  const remoteHead = await pushRemote(
    h.fake,
    [{ kind: "update-note", path: WELCOME, content: theirs }],
    remoteDeviceName,
  );
  h.engine.editNote(WELCOME, mine);
  await h.engine.flush();
  return { mine, theirs, remoteHead };
}
