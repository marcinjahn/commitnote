import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateSampleNotesRepo,
  generateSampleTrashRepo,
} from "../src/testing/sample-notes-repo/generate-sample-notes-repo";

async function main(): Promise<void> {
  const directory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../src/testing/sample-notes-repo",
  );
  const outputs = [
    ["sample-notes-repo.json", await generateSampleNotesRepo()],
    ["sample-trash-repo.json", await generateSampleTrashRepo()],
  ] as const;
  for (const [file, repo] of outputs) {
    await writeFile(
      resolve(directory, file),
      `${JSON.stringify(repo, null, 2)}\n`,
      "utf8",
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
