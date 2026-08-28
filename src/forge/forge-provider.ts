import type {
  ForgeAdapter,
  ForgeAdapterOptions,
} from "./forge-adapter";
import type { ForgeId, RepoCoordinates } from "./repo-coordinates";

export interface RepositorySummary {
  readonly coordinates: RepoCoordinates;
  readonly url: string;
}

export interface ForgeProvider {
  readonly id: ForgeId;
  readonly name: string;
  accessTokenCreationUrl(now: Date): string;
  /** Throws ForgeError. */
  listRepositories(accessToken: string): Promise<RepositorySummary[]>;
  createAdapter(
    coordinates: RepoCoordinates,
    options: ForgeAdapterOptions,
  ): ForgeAdapter;
}
