import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBrandSvgs, FONT_FILE } from "./brand-svgs";
import { loadFont } from "./font-outlining";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const font = await loadFont(resolve(root, FONT_FILE));
  for (const { path, contents } of buildBrandSvgs(font)) {
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
    console.log(target);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
