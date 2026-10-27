import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateTestVectors } from "./test-vectors/generate-test-vectors";

async function main(): Promise<void> {
  const directory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../apps/test-vectors",
  );
  await mkdir(directory, { recursive: true });
  for (const [file, value] of Object.entries(await generateTestVectors())) {
    await writeFile(
      resolve(directory, file),
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
