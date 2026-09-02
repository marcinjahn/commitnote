export const FORGE_IDS = ["github", "gitlab"] as const;

export type ForgeId = (typeof FORGE_IDS)[number];

export interface RepoCoordinates {
  readonly forge: ForgeId;
  readonly owner: string;
  readonly repo: string;
}

export function isForgeId(value: unknown): value is ForgeId {
  return (FORGE_IDS as readonly unknown[]).includes(value);
}
