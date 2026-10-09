const HASHED_ASSET = /^assets\/.+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

export function isContentHashed(entry: string): boolean {
  return HASHED_ASSET.test(entry);
}

export function planInstall(
  entries: readonly string[],
  cachedUrls: ReadonlySet<string>,
  scope: string,
): { reuse: string[]; fetch: string[] } {
  const reuse: string[] = [];
  const fetch: string[] = [];
  for (const entry of entries) {
    if (isContentHashed(entry) && cachedUrls.has(new URL(entry, scope).href)) {
      reuse.push(entry);
    } else {
      fetch.push(entry);
    }
  }
  return { reuse, fetch };
}
