export function parseLinkHeader(value: string | null): Map<string, string> {
  const links = new Map<string, string>();
  if (value === null) return links;
  for (const match of value.matchAll(/<([^>]*)>([^,<]*)/g)) {
    const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i.exec(match[2]);
    if (rel === null) continue;
    const url = match[1];
    for (const name of (rel[1] ?? rel[2]).split(/\s+/)) {
      if (name !== "" && !links.has(name)) links.set(name, url);
    }
  }
  return links;
}
