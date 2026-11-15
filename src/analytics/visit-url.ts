/** One GoatCounter `/count` hit. Absent or null fields are left out of the request. */
export interface VisitHit {
  readonly path: string;
  readonly title: string;
  readonly referrer?: string | null;
  readonly screenWidth?: number | null;
  /** GoatCounter's client-side bot code; only codes of 150 and above are accepted. */
  readonly bot?: number | null;
  /** A `?`-prefixed query string that GoatCounter reads campaign parameters from. */
  readonly campaignQuery?: string | null;
}

export function visitUrl(endpoint: string, hit: VisitHit): string {
  const params: [string, string | number | null | undefined][] = [
    ["p", hit.path],
    ["t", hit.title],
    ["r", hit.referrer],
    ["s", hit.screenWidth],
    ["b", hit.bot],
    ["q", hit.campaignQuery],
  ];
  const query = params
    .filter(
      (entry): entry is [string, string | number] =>
        entry[1] !== null && entry[1] !== undefined && entry[1] !== "",
    )
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `${endpoint}?${query}`;
}
