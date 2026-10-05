import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { argon2idDirect } from "../../crypto/argon2";
import { memoizedArgon2id } from "../../crypto/testing/memoized-argon2id";
import { adapterFactoryFor } from "../../forge/registry";
import { resumeSession } from "../../login/login";
import { createSessionStore } from "../../session/session-store";
import { createFakeForge } from "./fake-forge-factory";
import {
  FAKE_FORGE_SESSION_ACCESS_TOKEN,
  rememberFixtureSession,
} from "./remembered-session";

const argon2id = memoizedArgon2id(argon2idDirect);

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe("rememberFixtureSession", () => {
  let indexedDB: IDBFactory;
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    indexedDB = new IDBFactory();
    storage = memoryStorage();
  });

  it.each([
    {
      repoUrl: "https://github.com/sample/notes",
      coordinates: { forge: "github", owner: "sample", repo: "notes" },
    },
    {
      repoUrl: "https://fakelab.test/team/notes",
      coordinates: { forge: "gitlab", owner: "team", repo: "notes" },
    },
  ])(
    "remembers a session for $repoUrl that resumes",
    async ({ repoUrl, coordinates }) => {
      const fakeForge = await createFakeForge({ argon2id });

      await rememberFixtureSession({
        registry: fakeForge.registry,
        repoUrl,
        argon2id,
        store: createSessionStore({ indexedDB, storage }),
      });

      const loaded = await createSessionStore({
        indexedDB,
        storage,
      }).loadRememberedSession();
      if (loaded === null) throw new Error("expected a remembered session");
      expect(loaded.repoUrl).toBe(repoUrl);
      expect(loaded.coordinates).toEqual(coordinates);
      expect(loaded.accessToken).toBe(FAKE_FORGE_SESSION_ACCESS_TOKEN);

      const resumed = await resumeSession(loaded, {
        createAdapter: adapterFactoryFor(fakeForge.registry),
        argon2id,
      });
      expect(resumed.kind).toBe("loggedIn");
    },
  );

  it("rejects an unknown repository and leaves the store empty", async () => {
    const fakeForge = await createFakeForge({ argon2id });

    await expect(
      rememberFixtureSession({
        registry: fakeForge.registry,
        repoUrl: "https://github.com/sample/missing",
        argon2id,
        store: createSessionStore({ indexedDB, storage }),
      }),
    ).rejects.toThrow("https://github.com/sample/missing");

    const store = createSessionStore({ indexedDB, storage });
    expect(await store.loadRememberedSession()).toBeNull();
    expect(store.lastRepoUrl()).toBeNull();
  });
});
