import type { ForgeId, RepoCoordinates } from "../repo-url/parse-repo-url";
import { createGitHubAdapter } from "./github/github-adapter";
import type { ForgeAdapter, ForgeAdapterOptions } from "./forge-adapter";

export type ForgeAdapterFactory = (
  coordinates: RepoCoordinates,
  options: ForgeAdapterOptions,
) => ForgeAdapter;

export const forgeRegistry: Readonly<Record<ForgeId, ForgeAdapterFactory>> = {
  github: (coordinates, options) => createGitHubAdapter(coordinates, options),
};

export function createForgeAdapter(
  coordinates: RepoCoordinates,
  options: ForgeAdapterOptions,
): ForgeAdapter {
  return forgeRegistry[coordinates.forge](coordinates, options);
}
