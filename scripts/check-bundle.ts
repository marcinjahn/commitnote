import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FAKE_FORGE_BANNER,
  FAKE_FORGE_CONTROLS_KEY,
} from "../src/testing/fake-forge/fake-forge-factory";
import { FAKE_FORGE_OPTIONS_KEY } from "../src/testing/fake-forge/fake-forge-options";

const SAMPLE_NOTES_REPO_PASSPHRASE = "sample notes repo passphrase";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function findForbidden(
  dir: string,
  needles: readonly string[],
): Promise<Array<{ readonly file: string; readonly needle: string }>> {
  const files = await collectFiles(dir);
  const hits: Array<{ readonly file: string; readonly needle: string }> = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const needle of needles) {
      if (text.includes(needle)) {
        hits.push({ file, needle });
      }
    }
  }
  return hits;
}

async function fileContainsAny(
  dir: string,
  needles: readonly string[],
): Promise<boolean> {
  const files = await collectFiles(dir);
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (needles.some((needle) => text.includes(needle))) {
      return true;
    }
  }
  return false;
}

async function main(): Promise<void> {
  const distDir = join(rootDir, "dist");
  const fakeDistDir = join(rootDir, "dist-fake");

  const forbiddenInProd = await findForbidden(distDir, [
    FAKE_FORGE_BANNER,
    SAMPLE_NOTES_REPO_PASSPHRASE,
    FAKE_FORGE_CONTROLS_KEY,
    FAKE_FORGE_OPTIONS_KEY,
  ]);
  if (forbiddenInProd.length > 0) {
    for (const hit of forbiddenInProd) {
      console.error(
        `dist/ leaks fake forge fixture data: "${hit.needle}" found in ${hit.file}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const fakeHasBanner = await fileContainsAny(fakeDistDir, [FAKE_FORGE_BANNER]);
  if (!fakeHasBanner) {
    console.error(
      `dist-fake/ does not contain the test-mode banner ("${FAKE_FORGE_BANNER}"); the check cannot prove it can detect a leak`,
    );
    process.exitCode = 1;
    return;
  }

  const fakeHasControlsKey = await fileContainsAny(fakeDistDir, [
    FAKE_FORGE_CONTROLS_KEY,
  ]);
  if (!fakeHasControlsKey) {
    console.error(
      `dist-fake/ does not contain the test controls key ("${FAKE_FORGE_CONTROLS_KEY}"); the check cannot prove it can detect a leak`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    "Bundle check passed: production build never ships fake forge fixtures.",
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
