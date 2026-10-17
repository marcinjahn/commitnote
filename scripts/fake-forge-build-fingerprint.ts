import { createHash } from "node:crypto";
import { readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const FAKE_FORGE_BUILD_FINGERPRINT_FILE = ".fake-forge-build-fingerprint";

const EXCLUDED_PATHS = new Set([
  "dist",
  "dist-fake",
  "test-results",
  "playwright-report",
  "blob-report",
  "playwright/.cache",
  "node_modules",
  ".git",
  ".jj",
  FAKE_FORGE_BUILD_FINGERPRINT_FILE,
]);

const NODE_MODULES_MARKER = "node_modules/.package-lock.json";

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function describeSymlink(absolute: string): Promise<string[]> {
  const fields = ["symlink", await readlink(absolute)];
  try {
    const target = await stat(absolute);
    if (target.isFile()) fields.push(sha256(await readFile(absolute)));
  } catch {
    // dangling links and loops contribute only their target string
  }
  return fields;
}

async function describeEntry(
  absolute: string,
  entry: { isFile(): boolean; isSymbolicLink(): boolean; isDirectory(): boolean },
): Promise<string[]> {
  if (entry.isFile()) return ["file", sha256(await readFile(absolute))];
  if (entry.isSymbolicLink()) return describeSymlink(absolute);
  return ["other"];
}

async function collectRecords(
  rootDir: string,
  relativeDir: string,
  records: string[][],
): Promise<void> {
  const absoluteDir = relativeDir === "" ? rootDir : join(rootDir, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    const relative = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (relative === "node_modules") {
      const marker = await readMarker(rootDir);
      if (marker) records.push([NODE_MODULES_MARKER, ...marker]);
      continue;
    }
    if (EXCLUDED_PATHS.has(relative)) continue;
    if (entry.isDirectory()) {
      await collectRecords(rootDir, relative, records);
      continue;
    }
    records.push([relative, ...(await describeEntry(join(rootDir, relative), entry))]);
  }
}

async function readMarker(rootDir: string): Promise<string[] | null> {
  try {
    return ["file", sha256(await readFile(join(rootDir, NODE_MODULES_MARKER)))];
  } catch {
    return null;
  }
}

export async function computeFakeForgeBuildFingerprint(
  rootDir: string,
  env: Record<string, string | undefined>,
  nodeVersion: string,
): Promise<string> {
  const records: string[][] = [];
  await collectRecords(rootDir, "", records);
  records.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const hash = createHash("sha256");
  const feed = (fields: string[]) => {
    for (const field of fields) hash.update(`${Buffer.byteLength(field)}:${field}\0`);
    hash.update("\n");
  };
  for (const record of records) feed(record);
  feed(["node", nodeVersion]);
  const viteKeys = Object.keys(env)
    .filter((key) => key.startsWith("VITE_"))
    .sort();
  for (const key of viteKeys) feed(["env", `${key}=${env[key] ?? ""}`]);
  return hash.digest("hex");
}

export async function recordFakeForgeBuildFingerprint(
  rootDir: string,
  fingerprint: string,
): Promise<void> {
  await writeFile(join(rootDir, FAKE_FORGE_BUILD_FINGERPRINT_FILE), `${fingerprint}\n`);
}

export async function clearFakeForgeBuildFingerprint(rootDir: string): Promise<void> {
  await rm(join(rootDir, FAKE_FORGE_BUILD_FINGERPRINT_FILE), { force: true });
}

export async function isFakeForgeBuildFresh(
  rootDir: string,
  fingerprint: string,
): Promise<boolean> {
  try {
    const index = await stat(join(rootDir, "dist-fake", "index.html"));
    if (!index.isFile()) return false;
    const recorded = await readFile(join(rootDir, FAKE_FORGE_BUILD_FINGERPRINT_FILE), "utf8");
    return recorded.trim() === fingerprint;
  } catch {
    return false;
  }
}
