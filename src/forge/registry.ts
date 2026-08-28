import { createGitHubProvider } from "./github/github-provider";
import type { ForgeAdapter, ForgeAdapterOptions } from "./forge-adapter";
import type { ForgeProvider } from "./forge-provider";
import type { ForgeId, RepoCoordinates } from "./repo-coordinates";

export type ForgeAdapterFactory = (
  coordinates: RepoCoordinates,
  options: ForgeAdapterOptions,
) => ForgeAdapter;

export type ForgeRegistry = Readonly<Record<ForgeId, ForgeProvider>>;

export const forgeRegistry: ForgeRegistry = {
  github: createGitHubProvider(),
};

export function forgeProviders(registry: ForgeRegistry): ForgeProvider[] {
  return Object.values(registry);
}

export function adapterFactoryFor(
  registry: ForgeRegistry,
): ForgeAdapterFactory {
  return (coordinates, options) =>
    registry[coordinates.forge].createAdapter(coordinates, options);
}
