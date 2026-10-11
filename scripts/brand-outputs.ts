import type { Font } from "fontkit";
import { buildAppIcons, buildDesktopIcons } from "./app-icons";
import { buildBrandSvgs } from "./brand-svgs";
import { buildShortcutIcons } from "./shortcut-icons";

export interface BrandOutput {
  path: string;
  contents: string | Uint8Array;
}

export async function buildBrandOutputs(font: Font): Promise<BrandOutput[]> {
  return [
    ...buildBrandSvgs(font), ...(await buildAppIcons(font)),
    ...(await buildDesktopIcons(font)),
    ...(await buildShortcutIcons()),
  ];
}
