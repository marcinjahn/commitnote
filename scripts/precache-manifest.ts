import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface PrecacheManifest {
  readonly buildId: string;
  readonly files: string[];
}

const MANIFEST_LINE = /^self\.__PRECACHE_MANIFEST__ = (.*);\n/;

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export async function listPrecacheFiles(outDir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(relativeDir: string): Promise<void> {
    const entries = await readdir(join(outDir, relativeDir), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(relative);
      } else if (relative !== "sw.js" && !entry.name.endsWith(".map")) {
        files.push(relative);
      }
    }
  }
  await walk("");
  return files.sort(compareCodeUnits);
}

export function computeBuildId(
  files: readonly { path: string; content: Uint8Array }[],
): string {
  const hash = createHash("sha256");
  const sorted = [...files].sort((a, b) => compareCodeUnits(a.path, b.path));
  for (const file of sorted) {
    hash.update(`${file.path}\0${file.content.byteLength}\0`);
    hash.update(file.content);
  }
  return hash.digest("hex").slice(0, 16);
}

export function formatPrecacheManifest({
  buildId,
  files,
}: PrecacheManifest): string {
  return `self.__PRECACHE_MANIFEST__ = ${JSON.stringify({ buildId, files })};\n`;
}

export function parsePrecacheManifest(
  swSource: string,
): PrecacheManifest | null {
  const match = MANIFEST_LINE.exec(swSource);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { buildId, files } = parsed as Record<string, unknown>;
  if (
    typeof buildId !== "string" ||
    !Array.isArray(files) ||
    !files.every((file) => typeof file === "string")
  ) {
    return null;
  }
  return { buildId, files };
}
