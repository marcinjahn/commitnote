import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { encryptName } from "../crypto/name-cipher";
import { decryptNote, encryptNote } from "../crypto/note-cipher";
import type { Session } from "../session/session";
import { createHostSessionStore } from "./host-session-store";
import type { HostServices } from "./host-services";
import { createCryptoShim } from "./runtime/crypto-shim";
import {
  createNodeHostServices,
  type NodeHostServices,
} from "./testing/node-host-services";

const PASSPHRASE = "correct horse battery staple";

let host: NodeHostServices;

beforeEach(() => {
  host = createNodeHostServices();
  const shim = createCryptoShim(() => host);
  vi.stubGlobal("crypto", shim.crypto);
  vi.stubGlobal("CryptoKey", shim.CryptoKey);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function bytes(seed: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: 32 }, (_, index) => (seed + index) & 0xff);
}

async function makeSession(): Promise<Session> {
  const aes = (seed: number) =>
    crypto.subtle.importKey("raw", bytes(seed), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  const hmac = (seed: number) =>
    crypto.subtle.importKey(
      "raw",
      bytes(seed),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  const keyring: Keyring = {
    contentKey: await aes(1),
    nameKey: await aes(40),
    nameIvKey: await hmac(80),
    keyCheckKey: await hmac(120),
  };
  return {
    repoUrl: "https://github.com/alice/notes",
    coordinates: { forge: "github", owner: "alice", repo: "notes" },
    accessToken: "token-123",
    keyring,
  };
}

describe("host session store", () => {
  it("restores a keyring that decrypts what the original encrypted", async () => {
    const session = await makeSession();
    const store = createHostSessionStore(host);
    expect(await store.start(session, { rememberMe: true })).toEqual({
      remembered: true,
    });

    const restored = await createHostSessionStore(host).loadRememberedSession();
    expect(restored).not.toBeNull();
    expect(restored).toMatchObject({
      repoUrl: session.repoUrl,
      coordinates: session.coordinates,
      accessToken: session.accessToken,
    });
    expect(restored!.keyring.contentKey).toBeInstanceOf(CryptoKey);

    const sealed = await encryptNote(session.keyring, "# secret");
    expect(await decryptNote(restored!.keyring, sealed)).toBe("# secret");
    expect(await encryptName(restored!.keyring, "Projects")).toBe(
      await encryptName(session.keyring, "Projects"),
    );
  });

  it("never hands the host a passphrase", async () => {
    const session = await makeSession();
    const save = vi.spyOn(host.rememberedSession, "save");
    await createHostSessionStore(host).start(session, { rememberMe: true });

    expect(save).toHaveBeenCalledTimes(1);
    const record = save.mock.calls[0][0];
    expect(JSON.stringify(record)).not.toContain(PASSPHRASE);
    expect(Object.keys(record).sort()).toEqual([
      "accessToken",
      "coordinates",
      "keys",
      "repoUrl",
    ]);
    for (const handle of Object.values(record.keys)) {
      expect(typeof handle).toBe("string");
    }
  });

  it("saves nothing and clears an older record when rememberMe is false", async () => {
    const session = await makeSession();
    const store = createHostSessionStore(host);
    await store.start(session, { rememberMe: true });

    const save = vi.spyOn(host.rememberedSession, "save");
    expect(await store.start(session, { rememberMe: false })).toEqual({
      remembered: false,
    });
    expect(save).not.toHaveBeenCalled();
    expect(await store.loadRememberedSession()).toBeNull();
  });

  it("persists the last-repository hints even without rememberMe", async () => {
    const session = await makeSession();
    await createHostSessionStore(host).start(session, { rememberMe: false });

    const next = createHostSessionStore(host);
    expect(next.lastRepoUrl()).toBe(session.repoUrl);
    expect(next.lastForgeId()).toBe("github");
    expect(host.deviceSettings.getItem("commitnote.repoUrl")).toBe(
      session.repoUrl,
    );
    expect(host.deviceSettings.getItem("commitnote.forge")).toBe("github");
  });

  it("clear forgets the session but keeps the hints", async () => {
    const session = await makeSession();
    const store = createHostSessionStore(host);
    await store.start(session, { rememberMe: true });
    await store.clear();

    expect(await store.loadRememberedSession()).toBeNull();
    expect(store.lastRepoUrl()).toBe(session.repoUrl);
  });

  it("discards a malformed host record", async () => {
    const clear = vi.fn(async () => {});
    const broken = {
      ...host,
      rememberedSession: {
        save: async () => {},
        load: async () =>
          ({
            repoUrl: "x",
            accessToken: "t",
            coordinates: { forge: "bitbucket", owner: "a", repo: "b" },
            keys: {},
          }) as never,
        clear,
      },
    } satisfies HostServices;

    expect(
      await createHostSessionStore(broken).loadRememberedSession(),
    ).toBeNull();
    expect(clear).toHaveBeenCalled();
  });

  it("reports remembered false when the host cannot save", async () => {
    const session = await makeSession();
    vi.spyOn(host.rememberedSession, "save").mockRejectedValue(
      new Error("keychain"),
    );
    expect(
      await createHostSessionStore(host).start(session, { rememberMe: true }),
    ).toEqual({ remembered: false });
  });

  it("returns null when nothing is remembered", async () => {
    expect(
      await createHostSessionStore(host).loadRememberedSession(),
    ).toBeNull();
  });
});
