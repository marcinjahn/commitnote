import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeBuildId,
  formatPrecacheManifest,
  listPrecacheFiles,
  parsePrecacheManifest,
} from "./precache-manifest";

const encoder = new TextEncoder();

function file(path: string, content: string) {
  return { path, content: encoder.encode(content) };
}

describe("listPrecacheFiles", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "precache-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lists nested files sorted and excludes worker, source maps and dotted paths", async () => {
    const paths = [
      "index.html",
      "sw.js",
      "x.js.map",
      "assets/b.js",
      "assets/a.js",
      "assets/deep/c.css",
      ".hidden/secret.js",
      "assets/.cache/d.js",
      ".dotfile",
      "icons/sw.js",
    ];
    for (const path of paths) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), "x");
    }

    expect(await listPrecacheFiles(dir)).toEqual([
      "assets/a.js",
      "assets/b.js",
      "assets/deep/c.css",
      "icons/sw.js",
      "index.html",
    ]);
  });
});

describe("computeBuildId", () => {
  it("returns 16 hex characters", () => {
    expect(computeBuildId([file("a", "1")])).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when manifest bytes change", () => {
    const before = computeBuildId([
      file("index.html", "<html>"),
      file("manifest.webmanifest", '{"name":"a"}'),
    ]);
    const after = computeBuildId([
      file("index.html", "<html>"),
      file("manifest.webmanifest", '{"name":"b"}'),
    ]);
    expect(after).not.toBe(before);
  });

  it("changes when a file is renamed", () => {
    expect(computeBuildId([file("a.js", "1")])).not.toBe(
      computeBuildId([file("b.js", "1")]),
    );
  });

  it("does not depend on input order", () => {
    const a = file("a.js", "1");
    const b = file("b.js", "2");
    expect(computeBuildId([a, b])).toBe(computeBuildId([b, a]));
  });

  it("separates path and content boundaries", () => {
    expect(computeBuildId([file("a", "bc")])).not.toBe(
      computeBuildId([file("ab", "c")]),
    );
  });
});

describe("precache manifest source", () => {
  const manifest = { buildId: "0123456789abcdef", files: ["a.js", "b/c.css"] };

  it("round-trips through the first line", () => {
    const source = formatPrecacheManifest(manifest) + "rest();";
    expect(source.split("\n")[0]).toBe(
      'self.__PRECACHE_MANIFEST__ = {"buildId":"0123456789abcdef","files":["a.js","b/c.css"]};',
    );
    expect(parsePrecacheManifest(source)).toEqual(manifest);
  });

  it("returns null without the manifest line", () => {
    expect(parsePrecacheManifest("self.addEventListener('fetch', f);")).toBeNull();
    expect(parsePrecacheManifest("")).toBeNull();
  });

  it("returns null for a malformed manifest", () => {
    expect(
      parsePrecacheManifest("self.__PRECACHE_MANIFEST__ = {oops};\n"),
    ).toBeNull();
    expect(
      parsePrecacheManifest('self.__PRECACHE_MANIFEST__ = {"buildId":1};\n'),
    ).toBeNull();
  });
});
