const OPENABLE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const WWW_PREFIX = /^www\./i;
const EMAIL = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/i;

function withScheme(url: string): string {
  if (WWW_PREFIX.test(url)) return `https://${url}`;
  if (EMAIL.test(url)) return `mailto:${url}`;
  return url;
}

export function toOpenableUrl(text: string): string | null {
  const url = withScheme(text);
  try {
    return OPENABLE_PROTOCOLS.has(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}
