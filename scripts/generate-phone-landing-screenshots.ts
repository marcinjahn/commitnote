import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ANDROID_SCREEN } from "./android-landing-screenshots";
import { IPHONE_SCREEN } from "./ios-landing-screenshots";
import {
  buildLandingScreenshots,
  type PhoneScreen,
} from "./phone-landing-screenshots";
import { decodePng, encodePng } from "./png-codec";

const VIEWS = ["tree", "note"] as const;
const APPEARANCES = ["light", "dark"] as const;
type View = (typeof VIEWS)[number];
type Appearance = (typeof APPEARANCES)[number];

interface Platform {
  screen: PhoneScreen;
  /** The file name the platform's screenshot job gives this view. */
  source(view: View, appearance: Appearance): string;
}

const PLATFORMS = {
  ios: {
    screen: IPHONE_SCREEN,
    source: (view, appearance) => `iphone-${appearance}-store-${view}.png`,
  },
  android: {
    screen: ANDROID_SCREEN,
    source: (view, appearance) => `android-${view}-${appearance}.png`,
  },
} satisfies Record<string, Platform>;
type PlatformName = keyof typeof PLATFORMS;

function isPlatformName(name: string | undefined): name is PlatformName {
  return name !== undefined && Object.hasOwn(PLATFORMS, name);
}

async function main(): Promise<void> {
  const [platformName, sourceDir, outDir] = process.argv.slice(2);
  if (!isPlatformName(platformName) || !sourceDir || !outDir) {
    throw new Error(
      `usage: generate-phone-landing-screenshots <${Object.keys(PLATFORMS).join("|")}> <screenshots-dir> <out-dir>`,
    );
  }
  const platform: Platform = PLATFORMS[platformName];
  await mkdir(outDir, { recursive: true });
  for (const view of VIEWS) {
    for (const appearance of APPEARANCES) {
      const source = resolve(sourceDir, platform.source(view, appearance));
      const screenshot = decodePng(await readFile(source));
      for (const { scale, image } of await buildLandingScreenshots(
        screenshot,
        platform.screen,
      )) {
        const target = resolve(
          outDir,
          `${platformName}-${view}-${appearance}@${scale}x.png`,
        );
        await writeFile(target, encodePng(image));
        console.log(target);
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
