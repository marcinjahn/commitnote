import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readPngSize } from "./png-size";

const root = fileURLToPath(new URL("..", import.meta.url));

interface ManifestImage {
  readonly src: string;
  readonly sizes: string;
  readonly purpose?: string;
  readonly form_factor?: string;
}

interface Manifest {
  readonly [key: string]: unknown;
  readonly icons: readonly ManifestImage[];
  readonly screenshots: readonly ManifestImage[];
  readonly shortcuts?: ReadonlyArray<{
    readonly name: string;
    readonly url: string;
    readonly icons?: readonly ManifestImage[];
  }>;
  readonly note_taking?: { readonly new_note_url?: string };
  readonly launch_handler?: { readonly client_mode?: string };
  readonly categories: readonly string[];
  readonly display_override?: readonly string[];
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(
    await readFile(resolve(root, "public/manifest.webmanifest"), "utf8"),
  ) as Manifest;
}

function referencedImages(manifest: Manifest): ManifestImage[] {
  return [
    ...manifest.icons,
    ...manifest.screenshots,
    ...(manifest.shortcuts ?? []).flatMap((shortcut) => shortcut.icons ?? []),
  ];
}

async function pngSizeOf(publicPath: string): Promise<string> {
  const { width, height } = readPngSize(
    await readFile(resolve(root, "public", publicPath)),
  );
  return `${width}x${height}`;
}

describe("web app manifest", () => {
  it("declares the fixed identity and display members", async () => {
    const manifest = await readManifest();

    expect(manifest).toMatchObject({
      id: "./",
      start_url: "./",
      scope: "./",
      name: "commitnote",
      short_name: "commitnote",
      display: "standalone",
      lang: "en",
      dir: "ltr",
    });
    expect(manifest.display_override).toEqual([
      "window-controls-overlay",
      "standalone",
    ]);
    expect(manifest.categories).toContain("productivity");
    expect(String(manifest.description).length).toBeGreaterThan(0);
  });

  it("references only relative files that exist with the declared PNG size", async () => {
    const images = referencedImages(await readManifest());

    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image.src).not.toMatch(/^\/|^[a-z][a-z0-9+.-]*:/i);
      expect(await pngSizeOf(image.src)).toBe(image.sizes);
    }
  });

  it("provides the icon purposes and screenshot form factors installs need", async () => {
    const { icons, screenshots } = await readManifest();
    const icon = (purpose: string, sizes?: string) =>
      icons.some(
        (candidate) =>
          candidate.purpose === purpose &&
          (sizes === undefined || candidate.sizes === sizes),
      );

    expect(icon("any", "192x192")).toBe(true);
    expect(icon("any", "512x512")).toBe(true);
    expect(icon("maskable", "512x512")).toBe(true);
    expect(icon("monochrome")).toBe(true);
    expect(
      screenshots.filter((shot) => shot.form_factor === "narrow"),
    ).toHaveLength(1);
    expect(
      screenshots.filter((shot) => shot.form_factor === "wide"),
    ).toHaveLength(1);
  });

  it("uses the light background colour for background and theme colours", async () => {
    const manifest = await readManifest();
    const css = await readFile(resolve(root, "src/app.css"), "utf8");
    const light = css.match(
      /--color-background:\s*light-dark\(\s*(#[0-9a-f]{3,8})\s*,/i,
    )?.[1];

    expect(light).toBeDefined();
    expect(manifest.background_color).toBe(light);
    expect(manifest.theme_color).toBe(light);
  });

  it("advertises the launch actions inside the scope", async () => {
    const manifest = await readManifest();
    const shortcuts = manifest.shortcuts ?? [];

    expect(shortcuts.map(({ name, url }) => ({ name, url }))).toEqual([
      { name: "New note", url: "./?action=new-note" },
      { name: "Search notes", url: "./?action=search" },
    ]);
    for (const shortcut of shortcuts) {
      expect(shortcut.icons).toHaveLength(1);
      expect(shortcut.icons?.[0]?.sizes).toBe("96x96");
    }
    expect(manifest.note_taking?.new_note_url).toBe("./?action=new-note");
    expect(manifest.launch_handler?.client_mode).toBe("focus-existing");

    const base = "https://example.test/app/manifest.webmanifest";
    const scope = new URL(String(manifest.scope), base);
    const urls = [
      ...shortcuts.map((shortcut) => shortcut.url),
      manifest.note_taking?.new_note_url ?? "",
    ];
    for (const url of urls) {
      const resolved = new URL(url, base);
      expect(resolved.origin).toBe(scope.origin);
      expect(resolved.pathname.startsWith(scope.pathname)).toBe(true);
    }
  });

  it("links an apple touch icon that is a 180x180 PNG", async () => {
    const html = await readFile(resolve(root, "index.html"), "utf8");
    const href = html
      .match(/<link\b[^>]*rel="apple-touch-icon"[^>]*>/)?.[0]
      .match(/\shref="([^"]+)"/)?.[1];

    expect(href).toBeDefined();
    expect(await pngSizeOf((href ?? "").replace(/^\//, ""))).toBe("180x180");
  });
});
