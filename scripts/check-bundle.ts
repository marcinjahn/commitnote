import { access, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
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
import {
  computeBuildId,
  parsePrecacheManifest,
} from "./precache-manifest";
import { LARGE_TREE_REPO_KEY } from "../src/testing/sample-notes-repo/large-tree-source";
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

async function findServiceWorkerProblems(
  outDir: string,
): Promise<{ readonly problems: string[]; readonly fileCount: number | null }> {
  const swPath = join(outDir, "sw.js");
  if (!(await exists(swPath))) {
    return { problems: ["sw.js is missing"], fileCount: null };
  }
  const sw = await readFile(swPath);

  const killSwitchPath = join(rootDir, "public", "sw.js");
  if (await exists(killSwitchPath)) {
    const killSwitch = await readFile(killSwitchPath);
    return {
      problems: sw.equals(killSwitch)
        ? []
        : ["sw.js differs from public/sw.js, which must be shipped unchanged"],
      fileCount: null,
    };
  }

  const manifest = parsePrecacheManifest(sw.toString("utf8"));
  if (manifest === null) {
    return {
      problems: ["sw.js has no valid precache manifest"],
      fileCount: null,
    };
  }

  const problems: string[] = [];
  const listed = new Set(manifest.files);
  const emitted = new Set(
    (await collectFiles(outDir))
      .map((file) => relative(outDir, file).split("\\").join("/"))
      .filter((file) => file !== "sw.js"),
  );
  for (const file of [...emitted].sort()) {
    if (!listed.has(file)) {
      problems.push(`sw.js precache list is missing emitted file ${file}`);
    }
  }
  for (const file of [...listed].sort()) {
    if (!emitted.has(file)) {
      problems.push(`sw.js precache list contains ${file}, which was not emitted`);
    }
  }

  const required = ["index.html", "manifest.webmanifest"];
  try {
    const webManifest = JSON.parse(
      await readFile(join(outDir, "manifest.webmanifest"), "utf8"),
    ) as WebManifest;
    for (const { src } of webManifest.icons ?? []) {
      required.push(relative(outDir, resolve(outDir, src)).split("\\").join("/"));
    }
  } catch {
    problems.push("manifest.webmanifest cannot be read to check its icons");
  }
  for (const file of required) {
    if (!listed.has(file)) {
      problems.push(`sw.js precache list does not include ${file}`);
    }
  }

  const contents: Array<{ path: string; content: Uint8Array }> = [];
  for (const path of manifest.files) {
    if (emitted.has(path)) {
      contents.push({ path, content: await readFile(join(outDir, path)) });
    }
  }
  const actualBuildId = computeBuildId(contents);
  if (problems.length === 0 && actualBuildId !== manifest.buildId) {
    problems.push(
      `sw.js build id ${manifest.buildId} does not match the files on disk (${actualBuildId})`,
    );
  }
  return { problems, fileCount: manifest.files.length };
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
    LARGE_TREE_REPO_KEY,
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
    LARGE_TREE_REPO_KEY,
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

  if (!fakeHits.some((hit) => hit.needle === LARGE_TREE_REPO_KEY)) {
    console.error(
      `dist-fake/ does not contain the large tree fixture key ("${LARGE_TREE_REPO_KEY}"); the check cannot prove it can detect a leak`,
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

  const serviceWorkers: string[] = [];
  const swProblems: string[] = [];
  for (const dir of [distDir, fakeDistDir]) {
    const name = basename(dir);
    const result = await findServiceWorkerProblems(dir);
    swProblems.push(...result.problems.map((problem) => `${name}/${problem}`));
    serviceWorkers.push(
      result.fileCount === null
        ? "kill-switch service worker shipped"
        : `${result.fileCount} precached files`,
    );
  }
  if (swProblems.length > 0) {
    console.error(
      `Service worker check failed:\n${swProblems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Bundle check passed: production build never ships fake forge fixtures and ships a complete web app manifest, service worker (${serviceWorkers.join("; ")}).`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
