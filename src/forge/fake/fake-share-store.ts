import { ShareReadError } from "../share-host";
import type { ShareLocator, ShareReaders } from "../share-host";

export const FAKE_SHARE_STORE_KEY = "__commitNoteFakeShares";

const FIRST_SNIPPET_ID = 1000;

export interface FakeShareStore {
  create(provider: ShareLocator["provider"], envelope: string): ShareLocator;
  delete(locator: ShareLocator): boolean;
  read(locator: ShareLocator): string | null;
}

interface StoredShares {
  nextSnippetId: number;
  shares: Record<string, string>;
}

function inMemoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function randomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length / 2));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function shareKey(locator: ShareLocator): string {
  return locator.provider === "github"
    ? `gh:${locator.gistId}`
    : `gl:${locator.snippetId}`;
}

export function createFakeShareStore(
  storage: Pick<Storage, "getItem" | "setItem"> = inMemoryStorage(),
): FakeShareStore {
  function load(): StoredShares {
    const text = storage.getItem(FAKE_SHARE_STORE_KEY);
    if (text === null) {
      return { nextSnippetId: FIRST_SNIPPET_ID, shares: {} };
    }
    return JSON.parse(text) as StoredShares;
  }

  function save(state: StoredShares): void {
    storage.setItem(FAKE_SHARE_STORE_KEY, JSON.stringify(state));
  }

  return {
    create(provider, envelope) {
      const state = load();
      let locator: ShareLocator;
      if (provider === "github") {
        locator = { provider, gistId: randomHex(32) };
      } else {
        locator = { provider, snippetId: String(state.nextSnippetId) };
        state.nextSnippetId += 1;
      }
      state.shares[shareKey(locator)] = envelope;
      save(state);
      return locator;
    },
    delete(locator) {
      const state = load();
      const key = shareKey(locator);
      if (!(key in state.shares)) {
        return false;
      }
      delete state.shares[key];
      save(state);
      return true;
    },
    read(locator) {
      return load().shares[shareKey(locator)] ?? null;
    },
  };
}

export function createFakeShareReaders(store: FakeShareStore): ShareReaders {
  const reader = {
    read(locator: ShareLocator): Promise<string> {
      const envelope = store.read(locator);
      return envelope === null
        ? Promise.reject(new ShareReadError("notFound"))
        : Promise.resolve(envelope);
    },
  };
  return { github: reader, gitlab: reader };
}
