import { describe, expect, it } from "vitest";
import { encryptPath } from "../crypto/name-cipher";
import { encryptNote } from "../crypto/note-cipher";
import { ForgeError, type ForgeErrorKind } from "../forge/errors";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import type { AtomicCommitSupport, ForgeAdapter } from "../forge/forge-adapter";
import { CHANGE_PASSPHRASE_SUBJECT, MAIN_BRANCH } from "../format/v1";
import { createRateBudget } from "../sync/rate-budget";
import { createSyncEngine, type SyncEngine } from "../sync/sync-engine";
import { createTestClock } from "../sync/testing/test-clock";
import {
  commitPassphraseChange,
  MAX_BUDGET_WAIT_MS,
  preparePassphraseChange,
  settlePassphraseChange,
  type PassphraseChangeDeps,
  type PassphraseChangeStep,
} from "./change-passphrase";
import {
  createRekeyFixture,
  decryptTree,
  fastArgon2id,
  FIXTURE_NOTES,
  keyStateOf,
  NEW_PASSPHRASE,
  OLD_PASSPHRASE,
  readTree,
  type RekeyFixture,
} from "./testing/rekey-fixture";

type Operation = "getHead" | "listTree" | "readBlob" | "commit";

/** Per call: throw before it runs, or (commit only) run it and then throw. */
type Injection = (
  operation: Operation,
  call: number,
) => { readonly when: "before" | "after"; readonly error: ForgeError } | null;

function instrument(
  fake: FakeForgeAdapter,
  options?: {
    readonly inject?: Injection;
    readonly support?: AtomicCommitSupport;
  },
): ForgeAdapter & { calls: () => number } {
  let calls = 0;
  async function run<T>(operation: Operation, action: () => Promise<T>) {
    calls++;
    const injected = options?.inject?.(operation, calls) ?? null;
    if (injected?.when === "before") throw injected.error;
    const result = await action();
    if (injected?.when === "after") throw injected.error;
    return result;
  }
  return {
    calls: () => calls,
    limits: fake.limits,
    commitCost: (changes) => fake.commitCost(changes),
    inspect: () => fake.inspect(),
    initialize: (configText, message) => fake.initialize(configText, message),
    getHead: () => run("getHead", () => fake.getHead()),
    listTree: (sha) => run("listTree", () => fake.listTree(sha)),
    readBlob: (sha) => run("readBlob", () => fake.readBlob(sha)),
    commit: (request) => run("commit", () => fake.commit(request)),
    ...(options?.support === undefined
      ? {}
      : {
          atomicCommitSupport: async () => options.support!,
        }),
  };
}

interface Harness {
  readonly fixture: RekeyFixture;
  readonly engine: SyncEngine;
  readonly deps: PassphraseChangeDeps;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly before: Map<string, string>;
}

async function setup(options?: {
  readonly fixture?: RekeyFixture;
  readonly adapter?: (fake: FakeForgeAdapter) => ForgeAdapter;
}): Promise<Harness> {
  const fixture = options?.fixture ?? (await createRekeyFixture());
  const clock = createTestClock(1_000_000);
  const engine = createSyncEngine({
    adapter: fixture.adapter,
    keyring: fixture.oldKeyring,
    clock,
  });
  await engine.refresh();
  const adapter = options?.adapter?.(fixture.adapter) ?? fixture.adapter;
  const deps: PassphraseChangeDeps = {
    adapter,
    engine,
    rateBudget: createRateBudget(clock, adapter.limits),
    clock,
    argon2id: fastArgon2id,
    sleep: async () => {},
  };
  const before = await decryptTree(
    (await readTree(fixture.adapter)).files,
    fixture.oldKeyring,
  );
  return { fixture, engine, deps, clock, before };
}

const INPUT = {
  currentPassphrase: OLD_PASSPHRASE,
  newPassphrase: NEW_PASSPHRASE,
};

async function changePassphrase(h: Harness) {
  const prepared = await preparePassphraseChange(h.deps, INPUT);
  if (!prepared.ok) return prepared;
  return commitPassphraseChange(h.deps, prepared.prepared);
}

async function expectUnchanged(h: Harness): Promise<void> {
  const { head, files } = await readTree(h.fixture.adapter);
  expect(head).toBe(h.fixture.head);
  expect(await decryptTree(files, h.fixture.oldKeyring)).toEqual(h.before);
  expect(h.engine.getState().suspended).toBe(false);
}

describe("changing the passphrase", () => {
  it("re-encrypts everything in one commit on top of the head", async () => {
    const h = await setup();
    const steps: PassphraseChangeStep["kind"][] = [];

    const prepared = await preparePassphraseChange(h.deps, INPUT, (step) =>
      steps.push(step.kind),
    );
    if (!prepared.ok) throw new Error(prepared.failure.kind);
    const result = await commitPassphraseChange(
      h.deps,
      prepared.prepared,
      (step) => steps.push(step.kind),
    );
    if (!result.ok) throw new Error(result.failure.kind);

    const { head, files } = await readTree(h.fixture.adapter);
    const commit = h.fixture.adapter.repo.getCommit(head)!;
    expect(commit.parent).toBe(h.fixture.head);
    expect(commit.message.split("\n")[0]).toBe(CHANGE_PASSPHRASE_SUBJECT);
    expect(await keyStateOf(files, h.fixture.oldKeyring, result.keyring)).toBe(
      "new",
    );
    expect(await decryptTree(files, result.keyring)).toEqual(h.before);
    expect(new Set(steps)).toEqual(
      new Set([
        "saving",
        "checkingPassphrase",
        "derivingKeys",
        "reading",
        "encrypting",
        "verifying",
        "uploading",
      ]),
    );
  });

  it("keeps the engine suspended between preparing and committing", async () => {
    const h = await setup();

    const prepared = await preparePassphraseChange(h.deps, INPUT);

    expect(prepared.ok).toBe(true);
    expect(h.engine.getState().suspended).toBe(true);
    h.engine.editNote(["Welcome"], "typed while the change is reviewed");
    expect(h.engine.getState().pending).toEqual([]);
  });

  it("leaves a repo that a new engine opens with the new key", async () => {
    const h = await setup();
    const result = await changePassphrase(h);
    if (!result.ok) throw new Error(result.failure.kind);

    const engine = createSyncEngine({
      adapter: h.fixture.adapter,
      keyring: result.keyring,
      clock: h.clock,
    });
    await engine.refresh();

    expect(engine.getState().stopped).toBeNull();
    const names = engine
      .getState()
      .workingTree!.root.children.map((child) => child.name);
    expect(names).toEqual(expect.arrayContaining(["Projects", "Welcome"]));
    await engine.openNote(["Welcome"]);
    expect(engine.getState().openNote).toMatchObject({
      kind: "loaded",
      content: FIXTURE_NOTES.Welcome,
    });
    expect(engine.getState().visibleTrash).toHaveLength(1);
  });

  it("refuses a wrong current passphrase and changes nothing", async () => {
    const h = await setup();

    const result = await preparePassphraseChange(h.deps, {
      currentPassphrase: "not it",
      newPassphrase: NEW_PASSPHRASE,
    });

    expect(result).toEqual({ ok: false, failure: { kind: "wrongPassphrase" } });
    await expectUnchanged(h);
  });

  it("refuses an empty or unchanged new passphrase", async () => {
    const h = await setup();

    expect(
      await preparePassphraseChange(h.deps, {
        currentPassphrase: OLD_PASSPHRASE,
        newPassphrase: "  ",
      }),
    ).toEqual({ ok: false, failure: { kind: "emptyPassphrase" } });
    expect(
      await preparePassphraseChange(h.deps, {
        currentPassphrase: OLD_PASSPHRASE,
        newPassphrase: OLD_PASSPHRASE,
      }),
    ).toEqual({ ok: false, failure: { kind: "samePassphrase" } });
    await expectUnchanged(h);
  });

  it("saves pending edits first", async () => {
    const h = await setup();
    h.engine.editNote(["Welcome"], "edited before the change");

    const result = await changePassphrase(h);
    if (!result.ok) throw new Error(result.failure.kind);

    const files = (await readTree(h.fixture.adapter)).files;
    expect((await decryptTree(files, result.keyring)).get("Welcome")).toBe(
      "edited before the change",
    );
  });

  it("refuses while edits can't be saved", async () => {
    const h = await setup();
    h.fixture.adapter.failNext("commit", new ForgeError("Server"));
    h.engine.editNote(["Welcome"], "unsaved");

    const result = await preparePassphraseChange(h.deps, INPUT);

    expect(result).toEqual({
      ok: false,
      failure: { kind: "unsaved", count: 1 },
    });
    expect(h.engine.getState().suspended).toBe(false);
  });

  it("refuses when the notes changed on another device since the last refresh", async () => {
    const h = await setup();
    await pushFromOtherDevice(h);
    const head = await h.fixture.adapter.getHead();

    const result = await preparePassphraseChange(h.deps, INPUT);

    expect(result).toEqual({
      ok: false,
      failure: { kind: "changedElsewhere" },
    });
    expect(await h.fixture.adapter.getHead()).toBe(head);
    expect(h.engine.getState().suspended).toBe(false);
  });

  it("commits nothing when another device saved after preparing", async () => {
    const h = await setup();
    const prepared = await preparePassphraseChange(h.deps, INPUT);
    if (!prepared.ok) throw new Error(prepared.failure.kind);
    const theirs = await pushFromOtherDevice(h);

    const result = await commitPassphraseChange(h.deps, prepared.prepared);

    expect(result).toEqual({
      ok: false,
      failure: { kind: "changedElsewhere" },
    });
    const { head, files } = await readTree(h.fixture.adapter);
    expect(head).toBe(theirs);
    expect(
      await keyStateOf(files, h.fixture.oldKeyring, prepared.prepared.keyring),
    ).toBe("old");
    expect(h.engine.getState().suspended).toBe(false);
  });

  it("stops before reading anything when atomic commits need a setting change", async () => {
    let instrumented: ReturnType<typeof instrument> | undefined;
    const h = await setup({
      adapter: (fake) =>
        (instrumented = instrument(fake, {
          support: { kind: "needsSetup", canConfigure: true },
        })),
    });

    const result = await preparePassphraseChange(h.deps, INPUT);

    expect(result).toEqual({
      ok: false,
      failure: { kind: "needsSetup", canConfigure: true },
    });
    expect(instrumented!.calls()).toBe(0);
    await expectUnchanged(h);
  });

  it("refuses a note whose body can't be decrypted", async () => {
    const fixture = await createRekeyFixture({
      extraFiles: async (keyring) => ({
        [await encryptPath(keyring, ["Broken"])]: "v1:broken",
      }),
    });
    const h = await setup({ fixture });

    const result = await preparePassphraseChange(h.deps, INPUT);

    expect(result).toEqual({
      ok: false,
      failure: { kind: "undecryptableNote" },
    });
    await expectUnchanged(h);
  });

  it("reports a change that landed although the response was lost", async () => {
    let lost = false;
    const h = await setup({
      adapter: (fake) =>
        instrument(fake, {
          inject: (operation) => {
            if (operation !== "commit" || lost) return null;
            lost = true;
            return { when: "after", error: new ForgeError("Network") };
          },
        }),
    });

    const result = await changePassphrase(h);

    expect(result.ok).toBe(true);
    const files = (await readTree(h.fixture.adapter)).files;
    if (!result.ok) return;
    expect(await keyStateOf(files, h.fixture.oldKeyring, result.keyring)).toBe(
      "new",
    );
  });

  it("reports a change that landed although the commit failed afterwards", async () => {
    let failed = false;
    const h = await setup({
      adapter: (fake) =>
        instrument(fake, {
          inject: (operation) => {
            if (operation !== "commit" || failed) return null;
            failed = true;
            return { when: "after", error: new ForgeError("Server") };
          },
        }),
    });

    const result = await changePassphrase(h);

    expect(result).toMatchObject({ ok: true, check: "matched" });
  });

  it("resumes at once when the commit failed and main is known to be untouched", async () => {
    const h = await setup({
      adapter: (fake) =>
        instrument(fake, {
          inject: (operation) =>
            operation === "commit"
              ? {
                  when: "before",
                  error: new ForgeError("Network", { mainUnchanged: true }),
                }
              : null,
        }),
    });

    const result = await changePassphrase(h);

    expect(result).toEqual({
      ok: false,
      failure: { kind: "forge", error: { kind: "network" } },
    });
    await expectUnchanged(h);
  });

  describe("with an outcome that can't be determined", () => {
    async function unsettled() {
      let failing = true;
      let committing = false;
      const h = await setup({
        adapter: (fake) =>
          instrument(fake, {
            inject: (operation) =>
              failing && operation !== "listTree" && operation !== "readBlob"
                ? operation === "commit"
                  ? { when: "before", error: new ForgeError("Network") }
                  : operation === "getHead" && committing
                    ? { when: "before", error: new ForgeError("Network") }
                    : null
                : null,
          }),
      });
      const prepared = await preparePassphraseChange(h.deps, INPUT);
      if (!prepared.ok) throw new Error(prepared.failure.kind);
      committing = true;
      const result = await commitPassphraseChange(h.deps, prepared.prepared);
      failing = false;
      return { h, prepared: prepared.prepared, result };
    }

    it("keeps the engine suspended so nothing is written with the old key", async () => {
      const { h, result } = await unsettled();

      expect(result).toEqual({
        ok: false,
        failure: { kind: "outcomeUnknown" },
        unsettled: true,
      });
      expect(h.engine.getState().suspended).toBe(true);
      h.engine.editNote(["Welcome"], "typed meanwhile");
      expect(h.engine.getState().pending).toEqual([]);
    });

    it("settles as changed once the commit shows up on main", async () => {
      const { h, prepared } = await unsettled();
      await h.fixture.adapter.commit({
        parent: prepared.parent,
        changes: prepared.changes,
        message: "landed late",
      });

      const result = await settlePassphraseChange(h.deps, prepared);

      expect(result).toMatchObject({ ok: true, check: "matched" });
    });

    it("settles as unchanged and resumes once main moved on without it", async () => {
      const { h, prepared } = await unsettled();
      await pushFromOtherDevice(h);

      const result = await settlePassphraseChange(h.deps, prepared);

      expect(result).toEqual({
        ok: false,
        failure: { kind: "changedElsewhere" },
      });
      expect(h.engine.getState().suspended).toBe(false);
    });
  });

  it("reports main holding other files than the verified ones", async () => {
    const h = await setup({
      adapter: (fake) => ({
        ...instrument(fake),
        commit: (request) =>
          fake.commit({
            ...request,
            changes: request.changes.filter(
              (change) => change.path !== "README.md" && change.kind !== "delete",
            ),
          }),
      }),
    });

    const result = await changePassphrase(h);

    expect(result).toMatchObject({ ok: true, check: "mismatch" });
  });

  it("does not commit when the rate budget would make it wait too long", async () => {
    const h = await setup();
    const prepared = await preparePassphraseChange(h.deps, INPUT);
    if (!prepared.ok) throw new Error(prepared.failure.kind);
    const budget = createRateBudget(h.clock, { perMinute: 1, perHour: 1 });
    budget.record();

    const result = await commitPassphraseChange(
      { ...h.deps, rateBudget: budget },
      prepared.prepared,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("rateBudget");
    expect(MAX_BUDGET_WAIT_MS).toBeLessThan(3_600_000);
    await expectUnchanged(h);
  });

  it("stops an old-key device with pending edits instead of letting it write", async () => {
    const h = await setup();
    const stale = createSyncEngine({
      adapter: h.fixture.adapter,
      keyring: h.fixture.oldKeyring,
      clock: h.clock,
    });
    await stale.refresh();
    stale.editNote(["Welcome"], "typed on the stale device");

    const result = await changePassphrase(h);
    if (!result.ok) throw new Error(result.failure.kind);
    const changedHead = await h.fixture.adapter.getHead();
    await stale.flush();
    await stale.refresh();

    expect(stale.getState().stopped).toEqual({ kind: "keyChanged" });
    expect(stale.getState().syncStates.unsavedCount).toBe(1);
    const { head, files } = await readTree(h.fixture.adapter);
    expect(head).toBe(changedHead);
    expect(await keyStateOf(files, h.fixture.oldKeyring, result.keyring)).toBe(
      "new",
    );
  });
});

async function pushFromOtherDevice(h: Harness): Promise<string> {
  return h.fixture.adapter.pushFromAnotherDevice([
    {
      kind: "upsert-text",
      path: await encryptPath(h.fixture.oldKeyring, ["Welcome"]),
      text: await encryptNote(h.fixture.oldKeyring, "from another device"),
    },
  ]);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomNotes(random: () => number): Record<string, string> {
  const folders = ["", "A/", "A/B/", "C/"];
  const notes: Record<string, string> = {};
  const count = 1 + Math.floor(random() * 6);
  for (let i = 0; i < count; i++) {
    const folder = folders[Math.floor(random() * folders.length)];
    notes[`${folder}Note ${i}`] = `body ${i} ${random().toString(36)}`;
  }
  return notes;
}

const ERROR_KINDS: readonly ForgeErrorKind[] = [
  "Network",
  "Server",
  "RateLimited",
  "NotFound",
  "Unauthorized",
];

describe("changing the passphrase with a failure at any forge call", () => {
  for (const seed of [1, 2, 3]) {
    it(`leaves the repo entirely on one key (seed ${seed})`, async () => {
      const random = seededRandom(seed);
      const notes = randomNotes(random);

      let total = 0;
      {
        let counter: ReturnType<typeof instrument> | undefined;
        const h = await setup({
          fixture: await createRekeyFixture({ notes }),
          adapter: (fake) => (counter = instrument(fake)),
        });
        const result = await changePassphrase(h);
        expect(result.ok).toBe(true);
        total = counter!.calls();
      }
      expect(total).toBeGreaterThan(3);

      for (let k = 1; k <= total; k++) {
        const kind = ERROR_KINDS[Math.floor(random() * ERROR_KINDS.length)];
        const afterCommit = random() < 0.5;
        const h = await setup({
          fixture: await createRekeyFixture({ notes }),
          adapter: (fake) =>
            instrument(fake, {
              inject: (operation, call) => {
                if (call !== k) return null;
                const error = new ForgeError(
                  operation === "commit" && afterCommit ? "Network" : kind,
                  { retryAfterMs: 1 },
                );
                return {
                  when:
                    operation === "commit" && afterCommit ? "after" : "before",
                  error,
                };
              },
            }),
        });

        const prepared = await preparePassphraseChange(h.deps, INPUT);
        const result = prepared.ok
          ? await commitPassphraseChange(h.deps, prepared.prepared)
          : prepared;

        const { head, files } = await readTree(h.fixture.adapter);
        const newKeyring = prepared.ok ? prepared.prepared.keyring : null;
        if (head === h.fixture.head) {
          expect(await decryptTree(files, h.fixture.oldKeyring)).toEqual(
            h.before,
          );
          expect(result.ok).toBe(false);
          if (!result.ok) {
            const unsettled = "unsettled" in result && result.unsettled === true;
            expect(h.engine.getState().suspended).toBe(unsettled);
            expect(unsettled).toBe(result.failure.kind === "outcomeUnknown");
          }
        } else {
          expect(newKeyring).not.toBeNull();
          expect(h.fixture.adapter.repo.getRef(MAIN_BRANCH)).toBe(head);
          expect(
            await keyStateOf(files, h.fixture.oldKeyring, newKeyring!),
          ).toBe("new");
          expect(await decryptTree(files, newKeyring!)).toEqual(h.before);
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.check).not.toBe("mismatch");
        }
      }
    });
  }
});
