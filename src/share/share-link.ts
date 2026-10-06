import { fromBase64Url } from "../crypto/base64";
import type { ShareLocator } from "../forge/share-host";

export const SHARE_HASH_PREFIX = "#share=";

const LINK_VERSION = "1";
const GIST_ID_RE = /^[0-9a-f]{20,64}$/;
const REVISION_RE = /^[0-9a-f]{40}$/;
const SNIPPET_ID_RE = /^[1-9][0-9]{0,18}$/;
const LINK_SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
const LINK_SECRET_BYTES = 32;

export function isShareHash(hash: string): boolean {
  return hash.startsWith(SHARE_HASH_PREFIX);
}

export function shareLinkBase(
  location: Pick<Location, "origin" | "pathname">,
): string {
  return location.origin + location.pathname;
}

export function formatShareLink(
  base: string,
  locator: ShareLocator,
  linkSecret: string,
): string {
  const parts =
    locator.provider === "github"
      ? [LINK_VERSION, "gh", locator.gistId, locator.revision, linkSecret]
      : [LINK_VERSION, "gl", locator.snippetId, linkSecret];
  return `${base}${SHARE_HASH_PREFIX}${parts.join(".")}`;
}

export type ParsedShareLink =
  | {
      readonly kind: "valid";
      readonly locator: ShareLocator;
      readonly linkSecret: string;
    }
  | { readonly kind: "invalid" };

const INVALID: ParsedShareLink = { kind: "invalid" };

function isValidLinkSecret(secret: string): boolean {
  if (!LINK_SECRET_RE.test(secret)) {
    return false;
  }
  try {
    return fromBase64Url(secret).length === LINK_SECRET_BYTES;
  } catch {
    return false;
  }
}

export function parseShareLink(hash: string): ParsedShareLink {
  if (!isShareHash(hash)) {
    return INVALID;
  }
  const parts = hash.slice(SHARE_HASH_PREFIX.length).split(".");
  if (parts[0] !== LINK_VERSION) {
    return INVALID;
  }
  if (parts[1] === "gh" && parts.length === 5) {
    const [, , gistId, revision, linkSecret] = parts;
    if (
      GIST_ID_RE.test(gistId) &&
      REVISION_RE.test(revision) &&
      isValidLinkSecret(linkSecret)
    ) {
      return {
        kind: "valid",
        locator: { provider: "github", gistId, revision },
        linkSecret,
      };
    }
    return INVALID;
  }
  if (parts[1] === "gl" && parts.length === 4) {
    const [, , snippetId, linkSecret] = parts;
    if (SNIPPET_ID_RE.test(snippetId) && isValidLinkSecret(linkSecret)) {
      return {
        kind: "valid",
        locator: { provider: "gitlab", snippetId },
        linkSecret,
      };
    }
  }
  return INVALID;
}
