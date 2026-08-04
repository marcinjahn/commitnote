import type { Keyring } from "../crypto/keyring";
import type { RepoCoordinates } from "../repo-url/parse-repo-url";

export interface Session {
  readonly repoUrl: string;
  readonly coordinates: RepoCoordinates;
  readonly accessToken: string;
  readonly keyring: Keyring;
}
