export type ForgeId = "github";

export interface RepoCoordinates {
  readonly forge: ForgeId;
  readonly owner: string;
  readonly repo: string;
}

export type RepoUrlError =
  | { readonly kind: "malformed" }
  | { readonly kind: "unsupportedForge"; readonly host: string };

export type RepoUrlParseResult =
  | { readonly ok: true; readonly coordinates: RepoCoordinates }
  | { readonly ok: false; readonly error: RepoUrlError };

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const HOST_PATTERN =
  /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;
const SSH_PATTERN = /^git@([^@/:]+):(.+)$/;

function malformed(): RepoUrlParseResult {
  return { ok: false, error: { kind: "malformed" } };
}

function unsupportedForge(host: string): RepoUrlParseResult {
  return { ok: false, error: { kind: "unsupportedForge", host } };
}

function toForgeId(hostLower: string): ForgeId | null {
  if (hostLower === "github.com" || hostLower === "www.github.com") {
    return "github";
  }
  return null;
}

// Splits the URL (minus any scheme, and minus the SSH `git@` login) into its
// host and path parts, rejecting userinfo or a port living inside the host.
function splitHostAndPath(rest: string): { host: string; path: string } | null {
  const slashIndex = rest.indexOf("/");
  if (slashIndex === -1) return null;
  const host = rest.slice(0, slashIndex);
  const path = rest.slice(slashIndex + 1);
  if (host.includes("@") || host.includes(":")) return null;
  return { host, path };
}

function stripTrailingSlashAndGit(path: string): string {
  let result = path.endsWith("/") ? path.slice(0, -1) : path;
  if (/\.git$/i.test(result)) result = result.slice(0, -4);
  return result;
}

export function parseRepoUrl(input: string): RepoUrlParseResult {
  const trimmed = input.trim();
  if (trimmed === "") return malformed();
  if (/[?#]/.test(trimmed)) return malformed();

  let host: string;
  let rawPath: string;

  const sshMatch = SSH_PATTERN.exec(trimmed);
  if (sshMatch) {
    host = sshMatch[1];
    rawPath = sshMatch[2];
  } else {
    const schemeMatch = SCHEME_PATTERN.exec(trimmed);
    let rest = trimmed;
    if (schemeMatch) {
      if (schemeMatch[1].toLowerCase() !== "https") return malformed();
      rest = trimmed.slice(schemeMatch[0].length);
    }
    const split = splitHostAndPath(rest);
    if (!split) return malformed();
    host = split.host;
    rawPath = split.path;
  }

  if (!HOST_PATTERN.test(host)) return malformed();
  const hostLower = host.toLowerCase();

  const path = stripTrailingSlashAndGit(rawPath);
  const segments = path.split("/");
  if (segments.length !== 2 || segments[0] === "" || segments[1] === "") {
    return malformed();
  }
  const [owner, repo] = segments;

  if (!OWNER_PATTERN.test(owner)) return malformed();
  if (!REPO_PATTERN.test(repo) || repo === "." || repo === "..") {
    return malformed();
  }

  const forge = toForgeId(hostLower);
  if (!forge) return unsupportedForge(hostLower);

  return { ok: true, coordinates: { forge, owner, repo } };
}
