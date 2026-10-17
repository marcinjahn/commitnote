import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIconContactSheet } from "./app-icons";
import { FONT_FILE } from "./brand-svgs";
import { buildBrandOutputs } from "./brand-outputs";
import { loadFont } from "./font-outlining";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function contactSheetPath(args: string[]): string | undefined {
  const index = args.indexOf("--contact-sheet");
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined) {
    throw new Error("--contact-sheet needs a file path");
  }
  return resolve(value);
}

async function write(
  target: string,
  contents: string | Uint8Array,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await (typeof contents === "string"
    ? writeFile(target, contents, "utf8")
    : writeFile(target, contents));
  console.log(target);
}

async function main(): Promise<void> {
  const sheet = contactSheetPath(process.argv.slice(2));
  const font = await loadFont(resolve(root, FONT_FILE));
  for (const { path, contents } of await buildBrandOutputs(font)) {
    await write(resolve(root, path), contents);
  }
  if (sheet !== undefined) {
    await write(sheet, await buildIconContactSheet(font));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
