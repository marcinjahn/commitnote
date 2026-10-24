import { access, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
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
import { inlineScriptHashes } from "./csp";
import { LARGE_TREE_REPO_KEY } from "../src/testing/sample-notes-repo/large-tree-source";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../src/testing/sample-notes-repo/sample-source";

export const TAURI_NEEDLES = [
  "__TAURI_INTERNALS__",
  "plugin:opener",
  "plugin:dialog",
  "plugin:fs",
] as const;

const PROD_LEAK_NEEDLES: readonly string[] = [
  FAKE_FORGE_BANNER,
  SAMPLE_NOTES_REPO_PASSPHRASE,
  FAKE_FORGE_CONTROLS_KEY,
  FAKE_FORGE_OPTIONS_KEY,
  FAKE_FORGE_ARGON2_BINDING,
  FAKE_FORGE_SESSION_PARAM,
  FAKE_SHARE_STORE_KEY,
  LARGE_TREE_REPO_KEY,
];

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

async function findManifestProblems(
  distDir: string,
  label: string,
): Promise<string[]> {
  const manifestPath = join(distDir, "manifest.webmanifest");
  if (!(await exists(manifestPath))) {
    return [`${label}/manifest.webmanifest is missing`];
  }
  let manifest: WebManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as WebManifest;
  } catch {
    return [`${label}/manifest.webmanifest is not valid JSON`];
  }

  const problems: string[] = [];
  const references: Array<{ readonly from: string; readonly src: string }> = [
    ...(manifest.icons ?? []),
    ...(manifest.screenshots ?? []),
    ...(manifest.shortcuts ?? []).flatMap((shortcut) => shortcut.icons ?? []),
  ].map(({ src }) => ({ from: `${label}/manifest.webmanifest`, src }));

  const html = await readFile(join(distDir, "index.html"), "utf8");
  for (const rel of ["manifest", "apple-touch-icon"]) {
    const hrefs = linkHrefs(html, rel);
    if (hrefs.length === 0) {
      problems.push(`${label}/index.html has no rel="${rel}" link`);
    }
    references.push(
      ...hrefs.map((src) => ({ from: `${label}/index.html`, src })),
    );
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
  label: string,
): Promise<{ readonly problems: string[]; readonly fileCount: number | null }> {
  const swPath = join(outDir, "sw.js");
  if (!(await exists(swPath))) {
    return { problems: [`${label}/sw.js is missing`], fileCount: null };
  }
  const sw = await readFile(swPath);

  const killSwitchPath = join(rootDir, "public", "sw.js");
  if (await exists(killSwitchPath)) {
    const killSwitch = await readFile(killSwitchPath);
    return {
      problems: sw.equals(killSwitch)
        ? []
        : [
            `${label}/sw.js differs from public/sw.js, which must be shipped unchanged`,
          ],
      fileCount: null,
    };
  }

  const manifest = parsePrecacheManifest(sw.toString("utf8"));
  if (manifest === null) {
    return {
      problems: [`${label}/sw.js has no valid precache manifest`],
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
      problems.push(`${label}/sw.js precache list is missing emitted file ${file}`);
    }
  }
  for (const file of [...listed].sort()) {
    if (!emitted.has(file)) {
      problems.push(`${label}/sw.js precache list contains ${file}, which was not emitted`);
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
    problems.push(`${label}/manifest.webmanifest cannot be read to check its icons`);
  }
  for (const file of required) {
    if (!listed.has(file)) {
      problems.push(`${label}/sw.js precache list does not include ${file}`);
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
      `${label}/sw.js build id ${manifest.buildId} does not match the files on disk (${actualBuildId})`,
    );
  }
  return { problems, fileCount: manifest.files.length };
}

const LANDING_TEXT_BUDGET_BYTES = 40_960;
const LANDING_PNG_BUDGET_BYTES = 409_600;

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

async function findLandingProblems(
  siteDir: string,
  name: string,
): Promise<string[]> {
  const problems: string[] = [];
  const htmlPath = join(siteDir, "index.html");
  if (!(await exists(htmlPath))) {
    problems.push(`${name}/index.html is missing`);
  } else {
    const html = await readFile(htmlPath, "utf8");
    const cspTags = html.match(
      /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/g,
    );
    if (cspTags === null || cspTags.length !== 1) {
      problems.push(
        `${name}/index.html must contain exactly one Content-Security-Policy meta tag, found ${cspTags?.length ?? 0}`,
      );
    } else {
      const policy = cspTags[0].match(/\scontent="([^"]*)"/)?.[1] ?? "";
      if (!policy.includes("connect-src 'none'")) {
        problems.push(`${name}/index.html CSP does not contain connect-src 'none'`);
      }
      for (const hash of inlineScriptHashes(html)) {
        if (!policy.includes(hash)) {
          problems.push(
            `${name}/index.html CSP does not allow its inline script ${hash}`,
          );
        }
      }
    }
    if (linkHrefs(html, "manifest").length > 0) {
      problems.push(`${name}/index.html has a rel="manifest" link`);
    }
  }
  if (!(await exists(join(siteDir, "social.png")))) {
    problems.push(`${name}/social.png is missing`);
  }

  const swPath = join(siteDir, "sw.js");
  if (!(await exists(swPath))) {
    problems.push(`${name}/sw.js (retirement worker) is missing`);
  } else {
    const source = await readFile(join(rootDir, "landing", "public", "sw.js"));
    if (!(await readFile(swPath)).equals(source)) {
      problems.push(
        `${name}/sw.js differs from landing/public/sw.js, which must be shipped unchanged`,
      );
    }
  }

  for (const leaked of ["manifest.webmanifest", "icons"]) {
    if (await exists(join(siteDir, leaked))) {
      problems.push(`${name}/${leaked} exists; app files belong under ${name}/app/`);
    }
  }
  return problems;
}

async function findLandingBudgetProblems(
  siteDir: string,
  name: string,
): Promise<{ readonly problems: string[]; readonly textBytes: number }> {
  const problems: string[] = [];
  let textBytes = 0;
  for (const file of await collectFiles(siteDir)) {
    const rel = toPosix(relative(siteDir, file));
    if (rel.startsWith("app/") || rel === "sw.js") {
      continue;
    }
    const { size } = await stat(file);
    if (/\.(html|css|js)$/.test(rel)) {
      textBytes += size;
    } else if (rel.endsWith(".png") && size > LANDING_PNG_BUDGET_BYTES) {
      problems.push(
        `${name}/${rel} is ${size} bytes, over the ${LANDING_PNG_BUDGET_BYTES} byte image budget`,
      );
    }
  }
  if (textBytes > LANDING_TEXT_BUDGET_BYTES) {
    problems.push(
      `landing html, css and js in ${name}/ total ${textBytes} bytes, over the ${LANDING_TEXT_BUDGET_BYTES} byte budget`,
    );
  }
  return { problems, textBytes };
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const distDir = join(rootDir, "dist");
  const fakeDistDir = join(rootDir, "dist-fake");
  const desktopDistDir = join(rootDir, "dist-desktop");

  const forbiddenInProd = await findForbidden(distDir, PROD_LEAK_NEEDLES);
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

  const layoutProblems: string[] = [];
  for (const [siteDir, name] of [
    [distDir, "dist"],
    [fakeDistDir, "dist-fake"],
  ] as const) {
    layoutProblems.push(...(await findLandingProblems(siteDir, name)));
    if (!(await exists(join(siteDir, "app", "index.html")))) {
      layoutProblems.push(`${name}/app/index.html is missing`);
    }
  }
  if (layoutProblems.length > 0) {
    fail(
      `Site layout check failed:\n${layoutProblems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    return;
  }

  const manifestProblems = [
    ...(await findManifestProblems(join(distDir, "app"), "dist/app")),
    ...(await findManifestProblems(join(fakeDistDir, "app"), "dist-fake/app")),
  ];
  if (manifestProblems.length > 0) {
    fail(
      `The app does not ship a complete web app manifest:\n${manifestProblems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    return;
  }

  const serviceWorkers: string[] = [];
  const swProblems: string[] = [];
  for (const [dir, label] of [
    [join(distDir, "app"), "dist/app"],
    [join(fakeDistDir, "app"), "dist-fake/app"],
  ] as const) {
    const result = await findServiceWorkerProblems(dir, label);
    swProblems.push(...result.problems);
    serviceWorkers.push(
      result.fileCount === null
        ? "kill-switch service worker shipped"
        : `${result.fileCount} precached files`,
    );
  }
  if (swProblems.length > 0) {
    fail(
      `Service worker check failed:\n${swProblems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    return;
  }

  const budget = await findLandingBudgetProblems(distDir, "dist");
  if (budget.problems.length > 0) {
    fail(
      `Landing size budget check failed:\n${budget.problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    return;
  }

  const tauriInWeb = await findForbidden(distDir, TAURI_NEEDLES);
  if (tauriInWeb.length > 0) {
    for (const hit of tauriInWeb) {
      console.error(
        `dist/ ships desktop shell code: "${hit.needle}" found in ${hit.file}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const forbiddenInDesktop = await findForbidden(desktopDistDir, PROD_LEAK_NEEDLES);
  if (forbiddenInDesktop.length > 0) {
    for (const hit of forbiddenInDesktop) {
      console.error(
        `dist-desktop/ leaks fake forge fixture data: "${hit.needle}" found in ${hit.file}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const tauriInDesktop = new Set(
    (await findForbidden(desktopDistDir, TAURI_NEEDLES)).map((hit) => hit.needle),
  );
  const missingTauri = TAURI_NEEDLES.filter((needle) => !tauriInDesktop.has(needle));
  if (missingTauri.length > 0) {
    console.error(
      `dist-desktop/ does not contain ${missingTauri.map((needle) => `"${needle}"`).join(", ")}; the check cannot prove it can detect a Tauri leak`,
    );
    process.exitCode = 1;
    return;
  }

  for (const landingOnly of ["app", "social.png"]) {
    if (await exists(join(desktopDistDir, landingOnly))) {
      console.error(
        `dist-desktop/${landingOnly} exists; the desktop build is app-only and must not ship the landing page or an app path`,
      );
      process.exitCode = 1;
      return;
    }
  }

  if (await exists(join(desktopDistDir, "sw.js"))) {
    console.error(
      "dist-desktop/sw.js exists; the desktop build must not ship a service worker",
    );
    process.exitCode = 1;
    return;
  }

  const desktopHtml = await readFile(join(desktopDistDir, "index.html"), "utf8");
  const desktopCsp = desktopHtml.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/,
  )?.[1];
  if (desktopCsp === undefined) {
    console.error("dist-desktop/index.html has no Content-Security-Policy meta tag");
    process.exitCode = 1;
    return;
  }
  const missingCsp = ["https://gitlab.com", "ipc:"].filter(
    (value) => !desktopCsp.includes(value),
  );
  if (missingCsp.length > 0) {
    console.error(
      `dist-desktop/index.html CSP is missing ${missingCsp.map((value) => `"${value}"`).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Bundle check passed: production build never ships fake forge fixtures or desktop shell code and serves the landing page at the root and the app under app/ with a complete web app manifest and service worker (${serviceWorkers.join("; ")}); landing html, css and js total ${budget.textBytes} of ${LANDING_TEXT_BUDGET_BYTES} bytes; desktop build ships the desktop shell but no fake forge fixtures or service worker, and its CSP allows https://gitlab.com and ipc:.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
