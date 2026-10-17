import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FAKE_FORGE_BANNER,
  FAKE_FORGE_CONTROLS_KEY,
} from "../src/testing/fake-forge/fake-forge-factory";
import { FAKE_SHARE_STORE_KEY } from "../src/forge/fake/fake-share-store";
import {
  FAKE_FORGE_ARGON2_BINDING,
  FAKE_FORGE_OPTIONS_KEY,
} from "../src/testing/fake-forge/fake-forge-options";
import { FAKE_FORGE_SESSION_PARAM } from "../src/testing/fake-forge/remembered-session";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../src/testing/sample-notes-repo/sample-source";

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

interface ManifestImage {
  readonly src: string;
}

interface WebManifest {
  readonly icons?: readonly ManifestImage[];
  readonly screenshots?: readonly ManifestImage[];
  readonly shortcuts?: ReadonlyArray<{ readonly icons?: readonly ManifestImage[] }>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function linkHrefs(html: string, rel: string): string[] {
  const hrefs: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    if (tag.includes(`rel="${rel}"`)) {
      const href = tag.match(/\shref="([^"]+)"/)?.[1];
      if (href !== undefined) {
        hrefs.push(href);
      }
    }
  }
  return hrefs;
}

async function findManifestProblems(distDir: string): Promise<string[]> {
  const manifestPath = join(distDir, "manifest.webmanifest");
  if (!(await exists(manifestPath))) {
    return ["dist/manifest.webmanifest is missing"];
  }
  let manifest: WebManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as WebManifest;
  } catch {
    return ["dist/manifest.webmanifest is not valid JSON"];
  }

  const problems: string[] = [];
  const references: Array<{ readonly from: string; readonly src: string }> = [
    ...(manifest.icons ?? []),
    ...(manifest.screenshots ?? []),
    ...(manifest.shortcuts ?? []).flatMap((shortcut) => shortcut.icons ?? []),
  ].map(({ src }) => ({ from: "manifest.webmanifest", src }));

  const html = await readFile(join(distDir, "index.html"), "utf8");
  for (const rel of ["manifest", "apple-touch-icon"]) {
    const hrefs = linkHrefs(html, rel);
    if (hrefs.length === 0) {
      problems.push(`dist/index.html has no rel="${rel}" link`);
    }
    references.push(...hrefs.map((src) => ({ from: "index.html", src })));
  }

  for (const { from, src } of references) {
    const target = resolve(distDir, src);
    if (!(await exists(target))) {
      problems.push(`${from} references ${src}, but ${target} is missing`);
    }
  }
  return problems;
}

async function main(): Promise<void> {
  const distDir = join(rootDir, "dist");
  const fakeDistDir = join(rootDir, "dist-fake");

  const forbiddenInProd = await findForbidden(distDir, [
    FAKE_FORGE_BANNER,
    SAMPLE_NOTES_REPO_PASSPHRASE,
    FAKE_FORGE_CONTROLS_KEY,
    FAKE_FORGE_OPTIONS_KEY,
    FAKE_FORGE_ARGON2_BINDING,
    FAKE_FORGE_SESSION_PARAM,
    FAKE_SHARE_STORE_KEY,
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

  const fakeHits = await findForbidden(fakeDistDir, [
    FAKE_FORGE_BANNER,
    FAKE_FORGE_CONTROLS_KEY,
  ]);
  if (!fakeHits.some((hit) => hit.needle === FAKE_FORGE_BANNER)) {
    console.error(
      `dist-fake/ does not contain the test-mode banner ("${FAKE_FORGE_BANNER}"); the check cannot prove it can detect a leak`,
    );
    process.exitCode = 1;
    return;
  }

  if (!fakeHits.some((hit) => hit.needle === FAKE_FORGE_CONTROLS_KEY)) {
    console.error(
      `dist-fake/ does not contain the test controls key ("${FAKE_FORGE_CONTROLS_KEY}"); the check cannot prove it can detect a leak`,
    );
    process.exitCode = 1;
    return;
  }

  const manifestProblems = await findManifestProblems(distDir);
  if (manifestProblems.length > 0) {
    console.error(
      `dist/ does not ship a complete web app manifest:\n${manifestProblems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    "Bundle check passed: production build never ships fake forge fixtures and ships a complete web app manifest.",
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
