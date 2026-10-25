const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
]);

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function isArchiveImagePath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export function resolveArchiveImagePath(
  noteFolder: readonly string[],
  url: string,
): string | null {
  let destination =
    url.startsWith("<") && url.endsWith(">") && url.length >= 2
      ? url.slice(1, -1)
      : url;
  destination = destination.replace(/[?#].*$/s, "");
  if (
    destination === "" ||
    destination.startsWith("/") ||
    destination.includes("\\") ||
    URL_SCHEME.test(url.startsWith("<") ? url.slice(1) : url)
  ) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(destination);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.startsWith("/")) return null;

  const segments = [...noteFolder];
  for (const segment of decoded.split("/")) {
    if (segment === "") return null;
    if (segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const path = segments.join("/").normalize("NFC");
  return isArchiveImagePath(path) ? path : null;
}
