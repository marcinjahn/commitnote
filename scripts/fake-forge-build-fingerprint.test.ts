import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FAKE_FORGE_BUILD_FINGERPRINT_FILE,
  clearFakeForgeBuildFingerprint,
  computeFakeForgeBuildFingerprint,
  isFakeForgeBuildFresh,
  recordFakeForgeBuildFingerprint,
} from "./fake-forge-build-fingerprint";

const NODE = "v26.0.0";

describe("fake-forge build fingerprint", () => {
  let dir: string;
  let outside: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fingerprint-"));
    outside = await mkdtemp(join(tmpdir(), "fingerprint-outside-"));
    await put("src/main.ts", "main");
    await put("package.json", "{}");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  async function put(path: string, content: string) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  const compute = (env: Record<string, string | undefined> = {}, node = NODE) =>
    computeFakeForgeBuildFingerprint(dir, env, node);

  it("returns a lowercase hex SHA-256 that is stable across computations", async () => {
    const first = await compute();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await compute()).toBe(first);
  });

  it("changes when a file is changed, added, removed or renamed", async () => {
    const base = await compute();

    await put("src/main.ts", "changed");
    const changed = await compute();
    expect(changed).not.toBe(base);

    await put("src/extra.ts", "x");
    const added = await compute();
    expect(added).not.toBe(changed);

    await rm(join(dir, "src/extra.ts"));
    expect(await compute()).toBe(changed);

    await put("src/renamed.ts", "changed");
    await rm(join(dir, "src/main.ts"));
    expect(await compute()).not.toBe(changed);
  });

  it("includes dotfiles", async () => {
    const base = await compute();
    await put(".env.local", "A=1");
    expect(await compute()).not.toBe(base);
  });

  it("tracks only the npm installed-tree lockfile marker under node_modules", async () => {
    await put("node_modules/.package-lock.json", "one");
    const base = await compute();

    await put("node_modules/.package-lock.json", "two");
    expect(await compute()).not.toBe(base);

    await put("node_modules/.package-lock.json", "one");
    await put("node_modules/pkg/index.js", "a");
    await put("node_modules/other.txt", "b");
    expect(await compute()).toBe(base);
    await put("node_modules/pkg/index.js", "changed");
    expect(await compute()).toBe(base);
  });

  it.each([
    "dist/index.html",
    "dist-fake/index.html",
    "test-results/a.txt",
    "playwright-report/index.html",
    "blob-report/r.zip",
    "playwright/.cache/x.json",
    ".git/HEAD",
    ".jj/repo/op",
    FAKE_FORGE_BUILD_FINGERPRINT_FILE,
  ])("ignores %s", async (path) => {
    const base = await compute();
    await put(path, "one");
    const added = await compute();
    expect(added).toBe(base);
    await put(path, "two");
    expect(await compute()).toBe(base);
  });

  it("does not ignore other files under playwright", async () => {
    const base = await compute();
    await put("playwright/config.json", "x");
    expect(await compute()).not.toBe(base);
  });

  it("reacts to VITE_ env vars and the node version only", async () => {
    const base = await compute();

    const added = await compute({ VITE_A: "1" });
    expect(added).not.toBe(base);
    expect(await compute({ VITE_A: "2" })).not.toBe(added);
    expect(await compute({ VITE_A: "1", VITE_B: "x" })).not.toBe(added);
    expect(await compute({})).toBe(base);

    expect(await compute({ OTHER: "1", NODE_ENV: "x" })).toBe(base);
    expect(await compute({}, "v27.0.0")).not.toBe(base);
  });

  describe("symlinks", () => {
    it("does not throw for outside, dangling and looping links", async () => {
      await put("real.txt", "r");
      await writeFile(join(outside, "target.txt"), "t");
      await symlink(join(outside, "target.txt"), join(dir, "outside-link"));
      await symlink(join(dir, "missing"), join(dir, "dangling-link"));
      await symlink(join(dir, "loop-b"), join(dir, "loop-a"));
      await symlink(join(dir, "loop-a"), join(dir, "loop-b"));
      await symlink(outside, join(dir, "dir-link"));

      await expect(compute()).resolves.toMatch(/^[0-9a-f]{64}$/);
    });

    it("changes when a symlink target changes", async () => {
      await put("a.txt", "same");
      await put("b.txt", "same");
      await symlink("a.txt", join(dir, "link"));
      const base = await compute();

      await unlink(join(dir, "link"));
      await symlink("b.txt", join(dir, "link"));
      expect(await compute()).not.toBe(base);
    });

    it("changes when the content behind a file symlink changes", async () => {
      await writeFile(join(outside, "target.txt"), "one");
      await symlink(join(outside, "target.txt"), join(dir, "link"));
      const base = await compute();

      await writeFile(join(outside, "target.txt"), "two");
      expect(await compute()).not.toBe(base);
    });

    it("does not descend into symlinked directories", async () => {
      await writeFile(join(outside, "inner.txt"), "one");
      await symlink(outside, join(dir, "dir-link"));
      const base = await compute();

      await writeFile(join(outside, "inner.txt"), "two");
      expect(await compute()).toBe(base);
    });
  });

  describe("isFakeForgeBuildFresh", () => {
    it("is true when the record matches and dist-fake/index.html exists", async () => {
      await put("dist-fake/index.html", "<html>");
      const fingerprint = await compute();
      await recordFakeForgeBuildFingerprint(dir, fingerprint);
      expect(await isFakeForgeBuildFresh(dir, fingerprint)).toBe(true);
    });

    it("is false when dist-fake is missing", async () => {
      const fingerprint = await compute();
      await recordFakeForgeBuildFingerprint(dir, fingerprint);
      expect(await isFakeForgeBuildFresh(dir, fingerprint)).toBe(false);
    });

    it("is false when the record is missing", async () => {
      await put("dist-fake/index.html", "<html>");
      expect(await isFakeForgeBuildFresh(dir, await compute())).toBe(false);
    });

    it("is false after the record is cleared, and clearing twice is fine", async () => {
      await put("dist-fake/index.html", "<html>");
      const fingerprint = await compute();
      await recordFakeForgeBuildFingerprint(dir, fingerprint);
      await clearFakeForgeBuildFingerprint(dir);
      expect(await isFakeForgeBuildFresh(dir, fingerprint)).toBe(false);
      await expect(clearFakeForgeBuildFingerprint(dir)).resolves.toBeUndefined();
    });

    it("is false when the record holds a different fingerprint", async () => {
      await put("dist-fake/index.html", "<html>");
      await recordFakeForgeBuildFingerprint(dir, "0".repeat(64));
      expect(await isFakeForgeBuildFresh(dir, await compute())).toBe(false);
    });
  });
});
