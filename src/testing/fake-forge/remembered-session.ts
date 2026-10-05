import type { Argon2idFunction } from "../../crypto/argon2";
import { deriveKeyring, verifyKeyCheck } from "../../crypto/keyring";
import { parseRepoConfig } from "../../crypto/repo-config";
import type { RepositorySummary } from "../../forge/forge-provider";
import type { ForgeRegistry } from "../../forge/registry";
import { adapterFactoryFor, forgeProviders } from "../../forge/registry";
import type { SessionStore } from "../../session/session-store";
import { createSessionStore } from "../../session/session-store";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../sample-notes-repo/sample-source";

export const FAKE_FORGE_SESSION_PARAM = "fake-forge-session";
export const FAKE_FORGE_SESSION_ACCESS_TOKEN = "test-token";

async function findRepository(
  registry: ForgeRegistry,
  repoUrl: string,
): Promise<RepositorySummary> {
  for (const provider of forgeProviders(registry)) {
    const repositories = await provider.listRepositories(
      FAKE_FORGE_SESSION_ACCESS_TOKEN,
    );
    const summary = repositories.find((repository) => repository.url === repoUrl);
    if (summary !== undefined) return summary;
  }
  throw new Error(`No fake forge repository at ${repoUrl}`);
}

/**
 * Stores a remembered session for a fixture repository unlocked with the
 * sample passphrase, as logging in with Remember me would.
 */
export async function rememberFixtureSession(options: {
  readonly registry: ForgeRegistry;
  readonly repoUrl: string;
  readonly argon2id?: Argon2idFunction;
  readonly store?: SessionStore;
}): Promise<void> {
  const summary = await findRepository(options.registry, options.repoUrl);
  const accessToken = FAKE_FORGE_SESSION_ACCESS_TOKEN;
  const adapter = adapterFactoryFor(options.registry)(summary.coordinates, {
    accessToken,
  });

  const inspection = await adapter.inspect();
  const configText =
    inspection.kind === "populated"
      ? (inspection.main?.repoConfigText ?? null)
      : null;
  if (configText === null) {
    throw new Error(`${options.repoUrl} has no repo config`);
  }
  const parsed = parseRepoConfig(configText);
  if (parsed.kind !== "valid") {
    throw new Error(`${options.repoUrl} has an unusable repo config`);
  }

  const keyring = await deriveKeyring(
    SAMPLE_NOTES_REPO_PASSPHRASE,
    parsed.config.kdf,
    options.argon2id,
  );
  if (!(await verifyKeyCheck(keyring, parsed.config))) {
    throw new Error(
      `${options.repoUrl} does not unlock with the sample passphrase`,
    );
  }

  const store = options.store ?? createSessionStore();
  const { remembered } = await store.start(
    {
      repoUrl: summary.url,
      coordinates: summary.coordinates,
      accessToken,
      keyring,
    },
    { rememberMe: true },
  );
  if (!remembered) {
    throw new Error(`Could not remember the session for ${options.repoUrl}`);
  }
}
