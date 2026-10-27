import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readBackNativeRepo,
  type ReadBackScenario,
} from "./native-core/read-back";

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error("Usage: tsx scripts/read-back-native-repo.ts <dir>");
    process.exitCode = 1;
    return;
  }

  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) {
    console.error(`Read-back failed: ${dir} holds no scenario files`);
    process.exitCode = 1;
    return;
  }

  for (const file of files) {
    let scenario: ReadBackScenario;
    try {
      scenario = JSON.parse(
        await readFile(join(dir, file), "utf8"),
      ) as ReadBackScenario;
    } catch {
      console.error(`FAIL ${file}: not valid JSON`);
      process.exitCode = 1;
      continue;
    }
    let failures: string[];
    try {
      failures = await readBackNativeRepo(scenario);
    } catch (error) {
      failures = [
        `read-back threw ${error instanceof Error ? error.name : "a non-error"}`,
      ];
    }
    if (failures.length === 0) {
      console.log(`PASS ${file} (${scenario.name})`);
    } else {
      console.error(`FAIL ${file}: ${failures.join("; ")}`);
      process.exitCode = 1;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
