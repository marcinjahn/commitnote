import { isForgeId } from "../forge/repo-coordinates";
import type { Session } from "../session/session";
import {
  FORGE_ID_STORAGE_KEY,
  REPO_URL_STORAGE_KEY,
  type SessionStore,
} from "../session/session-store";
import type { HostServices, RememberedSessionRecord } from "./host-services";
import { cryptoKeyFromHandle, handleOfCryptoKey } from "./runtime/crypto-shim";

const AES_USAGES: KeyUsage[] = ["encrypt", "decrypt"];
const HMAC_USAGES: KeyUsage[] = ["sign", "verify"];

function isWellFormed(value: unknown): value is RememberedSessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.repoUrl !== "string" ||
    typeof record.accessToken !== "string"
  ) {
    return false;
  }
  const coordinates = record.coordinates as Record<string, unknown> | null;
  if (
    typeof coordinates !== "object" ||
    coordinates === null ||
    !isForgeId(coordinates.forge) ||
    typeof coordinates.owner !== "string" ||
    typeof coordinates.repo !== "string"
  ) {
    return false;
  }
  const keys = record.keys as Record<string, unknown> | null;
  if (typeof keys !== "object" || keys === null) return false;
  return (
    ["contentKey", "nameKey", "nameIvKey", "keyCheckKey"] as const
  ).every((field) => typeof keys[field] === "string");
}

export function createHostSessionStore(host: HostServices): SessionStore {
  function readHint(key: string): string | null {
    try {
      return host.deviceSettings.getItem(key);
    } catch {
      return null;
    }
  }

  function writeLastLogin(session: Session): void {
    try {
      host.deviceSettings.setItem(REPO_URL_STORAGE_KEY, session.repoUrl);
      host.deviceSettings.setItem(
        FORGE_ID_STORAGE_KEY,
        session.coordinates.forge,
      );
    } catch {
      // Treated as an unavailable store: the in-memory session still starts.
    }
  }

  async function clearRecord(): Promise<void> {
    try {
      await host.rememberedSession.clear();
    } catch {
      // Treated as an unavailable store.
    }
  }

  return {
    async start(session, { rememberMe }) {
      writeLastLogin(session);

      if (!rememberMe) {
        await clearRecord();
        return { remembered: false };
      }

      try {
        await host.rememberedSession.save({
          repoUrl: session.repoUrl,
          coordinates: { ...session.coordinates },
          accessToken: session.accessToken,
          keys: {
            contentKey: handleOfCryptoKey(session.keyring.contentKey),
            nameKey: handleOfCryptoKey(session.keyring.nameKey),
            nameIvKey: handleOfCryptoKey(session.keyring.nameIvKey),
            keyCheckKey: handleOfCryptoKey(session.keyring.keyCheckKey),
          },
        });
        return { remembered: true };
      } catch {
        return { remembered: false };
      }
    },

    async loadRememberedSession() {
      let record: RememberedSessionRecord | null;
      try {
        record = await host.rememberedSession.load();
      } catch {
        return null;
      }
      if (record === null) return null;
      if (!isWellFormed(record)) {
        await clearRecord();
        return null;
      }
      return {
        repoUrl: record.repoUrl,
        coordinates: record.coordinates,
        accessToken: record.accessToken,
        keyring: {
          contentKey: cryptoKeyFromHandle(
            record.keys.contentKey,
            "AES-GCM",
            AES_USAGES,
          ),
          nameKey: cryptoKeyFromHandle(
            record.keys.nameKey,
            "AES-GCM",
            AES_USAGES,
          ),
          nameIvKey: cryptoKeyFromHandle(
            record.keys.nameIvKey,
            "HMAC-SHA-256",
            HMAC_USAGES,
          ),
          keyCheckKey: cryptoKeyFromHandle(
            record.keys.keyCheckKey,
            "HMAC-SHA-256",
            HMAC_USAGES,
          ),
        },
      };
    },

    clear: clearRecord,

    lastRepoUrl: () => readHint(REPO_URL_STORAGE_KEY),

    lastForgeId: () => readHint(FORGE_ID_STORAGE_KEY),
  };
}
