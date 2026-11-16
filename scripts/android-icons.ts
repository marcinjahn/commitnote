import type { Font } from "fontkit";
import { LETTERS, MONOCHROME_LETTERS, TILE } from "./app-icons";
import type { BrandOutput } from "./brand-outputs";
import { FAVICON_STYLE, layoutFaviconGlyphs } from "./brand-svgs";
import { actionIcons, searchIcon } from "../src/ui/browse/action-icons";
import { GLYPH_BOX, STROKE_WIDTH } from "./shortcut-icons";

const RES = "apps/android/app/src/main/res";

export const ANDROID_ICONS = {
  launcher: `${RES}/mipmap-anydpi/ic_launcher.xml`,
  launcherBackground: `${RES}/drawable/ic_launcher_background.xml`,
  launcherForeground: `${RES}/drawable/ic_launcher_foreground.xml`,
  launcherMonochrome: `${RES}/drawable/ic_launcher_monochrome.xml`,
  newNote: `${RES}/drawable/ic_shortcut_new_note.xml`,
  newNoteForeground: `${RES}/drawable/ic_shortcut_new_note_foreground.xml`,
  search: `${RES}/drawable/ic_shortcut_search.xml`,
  searchForeground: `${RES}/drawable/ic_shortcut_search_foreground.xml`,
} as const;

export const VIEWPORT = 108;
export const SAFE_ZONE = 66;
export const LETTERS_FIT = 54;
export const SHORTCUT_GLYPH_SPAN = 40;

const SHORTCUT_SCALE = SHORTCUT_GLYPH_SPAN / GLYPH_BOX;
const SHORTCUT_OFFSET = (VIEWPORT - SHORTCUT_GLYPH_SPAN) / 2;

const NAMESPACE = 'xmlns:android="http://schemas.android.com/apk/res/android"';

function vector(...children: string[]): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<vector ${NAMESPACE}`,
    `    android:width="${VIEWPORT}dp"`,
    `    android:height="${VIEWPORT}dp"`,
    `    android:viewportWidth="${VIEWPORT}"`,
    `    android:viewportHeight="${VIEWPORT}">`,
    ...children,
    "</vector>",
    "",
  ].join("\n");
}

function adaptiveIcon(layers: Record<string, string>): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<adaptive-icon ${NAMESPACE}>`,
    ...Object.entries(layers).map(
      ([layer, drawable]) =>
        `    <${layer} android:drawable="@drawable/${drawable}"/>`,
    ),
    "</adaptive-icon>",
    "",
  ].join("\n");
}

function lettersVector(font: Font, fillColor: string): string {
  return vector(
    ...layoutFaviconGlyphs(font, FAVICON_STYLE, VIEWPORT, {
      kind: "box",
      size: LETTERS_FIT,
    }).map(
      (data) =>
        `    <path android:fillColor="${fillColor}" android:pathData="${data}"/>`,
    ),
  );
}

function glyphVector(glyph: readonly string[]): string {
  return vector(
    `    <group android:translateX="${SHORTCUT_OFFSET}" android:translateY="${SHORTCUT_OFFSET}" android:scaleX="${SHORTCUT_SCALE}" android:scaleY="${SHORTCUT_SCALE}">`,
    ...glyph.map(
      (data) =>
        `        <path android:strokeColor="${LETTERS}" android:strokeWidth="${STROKE_WIDTH}" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="${data}"/>`,
    ),
    "    </group>",
  );
}

export function buildAndroidIcons(font: Font): BrandOutput[] {
  return [
    {
      path: ANDROID_ICONS.launcherBackground,
      contents: vector(
        `    <path android:fillColor="${TILE}" android:pathData="M0,0h${VIEWPORT}v${VIEWPORT}h-${VIEWPORT}z"/>`,
      ),
    },
    {
      path: ANDROID_ICONS.launcherForeground,
      contents: lettersVector(font, LETTERS),
    },
    {
      path: ANDROID_ICONS.launcherMonochrome,
      contents: lettersVector(font, MONOCHROME_LETTERS),
    },
    {
      path: ANDROID_ICONS.launcher,
      contents: adaptiveIcon({
        background: "ic_launcher_background",
        foreground: "ic_launcher_foreground",
        monochrome: "ic_launcher_monochrome",
      }),
    },
    {
      path: ANDROID_ICONS.newNoteForeground,
      contents: glyphVector(actionIcons["new-note"]),
    },
    {
      path: ANDROID_ICONS.newNote,
      contents: adaptiveIcon({
        background: "ic_launcher_background",
        foreground: "ic_shortcut_new_note_foreground",
      }),
    },
    {
      path: ANDROID_ICONS.searchForeground,
      contents: glyphVector(searchIcon),
    },
    {
      path: ANDROID_ICONS.search,
      contents: adaptiveIcon({
        background: "ic_launcher_background",
        foreground: "ic_shortcut_search_foreground",
      }),
    },
  ];
}
