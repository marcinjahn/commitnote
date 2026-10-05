import { sharedMemoizedArgon2id } from "../../crypto/testing/shared-argon2id";
import { deriveKeyring, type Keyring } from "../../crypto/keyring";
import { parseRepoConfig, type RepoConfig } from "../../crypto/repo-config";
import { REPO_CONFIG_PATH } from "../../format/v1";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "./sample-source";
import { sampleNotesRepo } from "./seed-sample-notes-repo";

export function sampleNotesRepoConfig(): RepoConfig {
  const parsed = parseRepoConfig(
    sampleNotesRepo.commits[0].files[REPO_CONFIG_PATH],
  );
  if (parsed.kind !== "valid") {
    throw new Error(`expected a valid repo config, got ${parsed.kind}`);
  }
  return parsed.config;
}

let keyring: Promise<Keyring> | undefined;

export function sampleNotesRepoKeyring(): Promise<Keyring> {
  keyring ??= deriveKeyring(
    SAMPLE_NOTES_REPO_PASSPHRASE,
    sampleNotesRepoConfig().kdf,
    sharedMemoizedArgon2id,
  );
  return keyring;
}
