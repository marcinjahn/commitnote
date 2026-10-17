export const SHELL_CACHE_PREFIX = "commitnote-shell-";
export const SW_STATE_CACHE = "commitnote-sw-state";

export function shellCacheName(buildId: string): string {
  return `${SHELL_CACHE_PREFIX}${buildId}`;
}

function isShellCache(name: string): boolean {
  return name.startsWith(SHELL_CACHE_PREFIX);
}

export function planActivation(
  cacheNames: readonly string[],
  currentBuildId: string,
  previousBuildId: string | null,
): { keep: string[]; remove: string[] } {
  const current = shellCacheName(currentBuildId);
  const previous =
    previousBuildId !== null && previousBuildId !== currentBuildId
      ? shellCacheName(previousBuildId)
      : null;
  const keep: string[] = [];
  const remove: string[] = [];
  for (const name of cacheNames) {
    if (!isShellCache(name)) continue;
    if (name === current || name === previous) keep.push(name);
    else remove.push(name);
  }
  return { keep, remove };
}

export function lookupOrder(
  cacheNames: readonly string[],
  currentBuildId: string,
): string[] {
  const current = shellCacheName(currentBuildId);
  const shells = cacheNames.filter(isShellCache);
  return shells.includes(current)
    ? [current, ...shells.filter((name) => name !== current)]
    : shells;
}
