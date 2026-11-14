import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ANDROID_ICONS,
  buildAndroidIcons,
  LETTERS_FIT,
  SAFE_ZONE,
  SHORTCUT_GLYPH_SPAN,
  VIEWPORT,
} from "./android-icons";
import { LETTERS, MONOCHROME_LETTERS, TILE } from "./app-icons";
import { FONT_FILE } from "./brand-svgs";
import { GLYPH_BOX } from "./shortcut-icons";
import { loadFont } from "./font-outlining";

const root = fileURLToPath(new URL("..", import.meta.url));

const ROOT_ELEMENTS = {
  [ANDROID_ICONS.launcher]: "adaptive-icon",
  [ANDROID_ICONS.launcherBackground]: "vector",
  [ANDROID_ICONS.launcherForeground]: "vector",
  [ANDROID_ICONS.launcherMonochrome]: "vector",
  [ANDROID_ICONS.newNote]: "adaptive-icon",
  [ANDROID_ICONS.newNoteForeground]: "vector",
  [ANDROID_ICONS.search]: "adaptive-icon",
  [ANDROID_ICONS.searchForeground]: "vector",
} as const;

const SAFE_MIN = (VIEWPORT - SAFE_ZONE) / 2;
const SAFE_MAX = SAFE_MIN + SAFE_ZONE;

let files: Map<string, string>;

function contentsOf(path: string): string {
  const contents = files.get(path);
  if (contents === undefined) throw new Error(`Missing output ${path}`);
  return contents;
}

interface XmlElement {
  tag: string;
  attributes: Record<string, string>;
  children: XmlElement[];
}

const TOKEN = /<\/([\w-]+)>|<([\w-]+)((?:\s+[\w:]+="[^"<>]*")*)\s*(\/?)>/g;

function parseXml(xml: string): XmlElement {
  const body = xml.replace(/^<\?xml [^>]*\?>\s*/, "");
  const roots: XmlElement[] = [];
  const open: XmlElement[] = [];
  let position = 0;
  for (const match of body.matchAll(TOKEN)) {
    expect(body.slice(position, match.index).trim()).toBe("");
    position = match.index + match[0].length;
    const [, closing, tag, attributeText, selfClosing] = match;
    if (closing !== undefined) {
      expect(open.pop()?.tag).toBe(closing);
      continue;
    }
    const element: XmlElement = {
      tag,
      attributes: Object.fromEntries(
        [...attributeText.matchAll(/([\w:]+)="([^"]*)"/g)].map(
          ([, name, value]) => [name, value],
        ),
      ),
      children: [],
    };
    (open.at(-1)?.children ?? roots).push(element);
    if (selfClosing === "") open.push(element);
  }
  expect(body.slice(position).trim()).toBe("");
  expect(open).toHaveLength(0);
  expect(roots).toHaveLength(1);
  return roots[0];
}

function parsed(path: string): XmlElement {
  return parseXml(contentsOf(path));
}

function attribute(element: XmlElement | undefined, name: string): string {
  const value = element?.attributes[`android:${name}`];
  if (value === undefined) throw new Error(`Missing android:${name}`);
  return value;
}

function paths(path: string): XmlElement[] {
  const found: XmlElement[] = [];
  const visit = (element: XmlElement): void => {
    if (element.tag === "path") found.push(element);
    element.children.forEach(visit);
  };
  visit(parsed(path));
  return found;
}

function pathData(path: string): string[] {
  return paths(path).map((node) => attribute(node, "pathData"));
}

function layers(path: string): Record<string, string> {
  return Object.fromEntries(
    parsed(path).children.map((layer) => [
      layer.tag,
      attribute(layer, "drawable"),
    ]),
  );
}

beforeAll(async () => {
  const font = await loadFont(resolve(root, FONT_FILE));
  files = new Map(
    buildAndroidIcons(font).map((output) => [
      output.path,
      String(output.contents),
    ]),
  );
});

describe("Android icons", () => {
  it("produces exactly the expected resource files", () => {
    expect([...files.keys()].sort()).toEqual(
      Object.keys(ROOT_ELEMENTS).sort(),
    );
  });

  it("writes well-formed XML with the expected root element", () => {
    for (const [path, element] of Object.entries(ROOT_ELEMENTS)) {
      expect(parsed(path).tag, path).toBe(element);
      expect(contentsOf(path).endsWith(`</${element}>\n`), path).toBe(true);
    }
  });

  it("fills the background with the tile colour over the whole viewport", () => {
    const [data] = pathData(ANDROID_ICONS.launcherBackground);
    expect(data).toBe(`M0,0h${VIEWPORT}v${VIEWPORT}h-${VIEWPORT}z`);
    expect(contentsOf(ANDROID_ICONS.launcherBackground)).toContain(
      `android:fillColor="${TILE}"`,
    );
  });

  it("keeps the letters inside the safe zone", () => {
    for (const path of [
      ANDROID_ICONS.launcherForeground,
      ANDROID_ICONS.launcherMonochrome,
    ]) {
      const numbers = pathData(path)
        .join("")
        .match(/-?\d+(\.\d+)?/g)
        ?.map(Number);
      expect(numbers?.length, path).toBeGreaterThan(0);
      for (const value of numbers ?? []) {
        expect(value, path).toBeGreaterThanOrEqual(SAFE_MIN);
        expect(value, path).toBeLessThanOrEqual(SAFE_MAX);
      }
    }
    expect(LETTERS_FIT).toBeLessThanOrEqual(SAFE_ZONE);
  });

  it("draws the monochrome letters as the foreground geometry in black", () => {
    expect(pathData(ANDROID_ICONS.launcherMonochrome)).toEqual(
      pathData(ANDROID_ICONS.launcherForeground),
    );
    expect(contentsOf(ANDROID_ICONS.launcherForeground)).toContain(
      `android:fillColor="${LETTERS}"`,
    );
    expect(contentsOf(ANDROID_ICONS.launcherMonochrome)).toContain(
      `android:fillColor="${MONOCHROME_LETTERS}"`,
    );
  });

  it("references the layers of the launcher icon", () => {
    expect(layers(ANDROID_ICONS.launcher)).toEqual({
      background: "@drawable/ic_launcher_background",
      foreground: "@drawable/ic_launcher_foreground",
      monochrome: "@drawable/ic_launcher_monochrome",
    });
  });

  it.each([
    [ANDROID_ICONS.newNote, "ic_shortcut_new_note_foreground"],
    [ANDROID_ICONS.search, "ic_shortcut_search_foreground"],
  ])("wraps the %s glyph on the launcher background", (path, foreground) => {
    expect(layers(path)).toEqual({
      background: "@drawable/ic_launcher_background",
      foreground: `@drawable/${foreground}`,
    });
  });

  it.each([
    ANDROID_ICONS.newNoteForeground,
    ANDROID_ICONS.searchForeground,
  ])("centres the stroke glyph of %s inside the safe zone", (path) => {
    const group = parsed(path).children[0];
    expect(group.tag).toBe("group");
    const scale = Number(attribute(group, "scaleX"));
    const offset = Number(attribute(group, "translateX"));
    expect(Number(attribute(group, "scaleY"))).toBe(scale);
    expect(Number(attribute(group, "translateY"))).toBe(offset);
    expect(scale * GLYPH_BOX).toBeCloseTo(SHORTCUT_GLYPH_SPAN);
    expect(offset).toBeGreaterThanOrEqual(SAFE_MIN);
    expect(offset + SHORTCUT_GLYPH_SPAN).toBeLessThanOrEqual(SAFE_MAX);
    expect(offset * 2 + SHORTCUT_GLYPH_SPAN).toBeCloseTo(VIEWPORT);
    for (const node of paths(path)) {
      expect(attribute(node, "strokeColor")).toBe(LETTERS);
      expect(node.attributes["android:fillColor"]).toBeUndefined();
    }
  });
});
