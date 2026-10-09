import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearFakeForgeBuildFingerprint,
  computeFakeForgeBuildFingerprint,
  isFakeForgeBuildFresh,
  recordFakeForgeBuildFingerprint,
} from "./fake-forge-build-fingerprint";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runBuild(): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawn(
      join(rootDir, "node_modules", ".bin", "vite"),
      ["build", "--mode", "fake-forge", "--outDir", "dist-fake"],
      { cwd: rootDir, stdio: "inherit" },
    );
    child.on("error", (error) => {
      console.error(error);
      resolveExit(1);
    });
    child.on("close", (code) => resolveExit(code ?? 1));
  });
}

async function safeClear(): Promise<void> {
  try {
    await clearFakeForgeBuildFingerprint(rootDir);
  } catch (error) {
    console.warn("build:fake: could not clear the fake-forge build fingerprint", error);
  }
}

async function main(): Promise<number> {
  const ifStale = process.argv.includes("--if-stale");
  let fingerprint: string | null = null;
  try {
    fingerprint = await computeFakeForgeBuildFingerprint(rootDir, process.env, process.version);
  } catch (error) {
    console.warn("build:fake: could not compute the fake-forge build fingerprint", error);
  }

  if (fingerprint !== null && ifStale && (await isFakeForgeBuildFresh(rootDir, fingerprint))) {
    console.log("dist-fake is fresh (fake-forge build fingerprint matches); skipping build:fake");
    return 0;
  }

  await safeClear();
  const code = await runBuild();
  if (code === 0 && fingerprint !== null) {
    try {
      await recordFakeForgeBuildFingerprint(rootDir, fingerprint);
    } catch (error) {
      console.warn("build:fake: could not record the fake-forge build fingerprint", error);
    }
  }
  return code;
}

process.exitCode = await main();
