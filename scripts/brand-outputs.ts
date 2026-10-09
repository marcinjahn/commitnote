import type { Font } from "fontkit";
import { buildAppIcons } from "./app-icons";
import { buildBrandSvgs } from "./brand-svgs";
import { buildShortcutIcons } from "./shortcut-icons";

export interface BrandOutput {
  path: string;
  contents: string | Uint8Array;
}

export async function buildBrandOutputs(font: Font): Promise<BrandOutput[]> {
  return [
    ...buildBrandSvgs(font), ...(await buildAppIcons(font)),
    ...(await buildShortcutIcons()),
  ];
}
