import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSampleNotesRepo } from "../src/testing/sample-notes-repo/generate-sample-notes-repo";

async function main(): Promise<void> {
  const repo = await generateSampleNotesRepo();
  const outputPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../src/testing/sample-notes-repo/sample-notes-repo.json",
  );
  await writeFile(outputPath, `${JSON.stringify(repo, null, 2)}\n`, "utf8");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
