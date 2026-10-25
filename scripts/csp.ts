import { createHash } from "node:crypto";

export type CspTarget = "web" | "desktop" | "landing";

export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(
    /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    const digest = createHash("sha256").update(match[1]).digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

export function buildCsp(
  target: CspTarget,
  scriptHashes: readonly string[],
  analyticsEndpoint: string | null,
): string {
  const analyticsOrigin =
    analyticsEndpoint === null ? null : new URL(analyticsEndpoint).origin;
  if (target === "landing") {
    return [
      "default-src 'self'",
      ["script-src 'self'", ...scriptHashes].join(" "),
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      analyticsOrigin === null
        ? "connect-src 'none'"
        : `connect-src ${analyticsOrigin}`,
      "worker-src 'none'",
      "manifest-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
  }
  const scriptSrc = ["script-src 'self' 'wasm-unsafe-eval'", ...scriptHashes];
  const connectSrc = ["connect-src https://api.github.com https://gitlab.com"];
  if (target === "desktop") {
    connectSrc.push("ipc: http://ipc.localhost");
  }
  if (analyticsOrigin !== null) {
    connectSrc.push(analyticsOrigin);
  }
  return [
    "default-src 'self'",
    scriptSrc.join(" "),
    "style-src 'self' 'unsafe-inline'",
    connectSrc.join(" "),
    "img-src 'self' https: data: blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
  ].join("; ");
}
