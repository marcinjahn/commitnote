import { describe, expect, it } from "vitest";
import { isContentHashed, planInstall } from "./install-plan";

const scope = "https://example.test/app/";
const abs = (entry: string) => new URL(entry, scope).href;

describe("isContentHashed", () => {
  it.each([
    "assets/index-DLicD9v2.js",
    "assets/InterVariable-DoYnprok.woff2",
    "assets/dist-3H1nCAPe.js",
    "assets/favicon-tkZKztie.svg",
    "assets/share-host-_-abc123.css",
  ])("accepts %s", (entry) => {
    expect(isContentHashed(entry)).toBe(true);
  });

  it.each([
    "index.html",
    "manifest.webmanifest",
    "icons/icon-192.png",
    "screenshots/mobile-light.png",
    "assets/plain.js",
    "icons/assets/index-DLicD9v2.js",
  ])("rejects %s", (entry) => {
    expect(isContentHashed(entry)).toBe(false);
  });
});

describe("planInstall", () => {
  it("reuses a content-hashed entry that is already cached", () => {
    const entries = ["assets/index-DLicD9v2.js"];
    expect(planInstall(entries, new Set(entries.map(abs)), scope)).toEqual({
      reuse: entries,
      fetch: [],
    });
  });

  it("fetches a content-hashed entry that is not cached", () => {
    const entries = ["assets/index-DLicD9v2.js"];
    expect(
      planInstall(entries, new Set([abs("assets/index-AAAAAAAA.js")]), scope),
    ).toEqual({ reuse: [], fetch: entries });
  });

  it("fetches non-hashed entries even when they are cached", () => {
    const entries = [
      "index.html",
      "manifest.webmanifest",
      "icons/icon-192.png",
      "screenshots/mobile-light.png",
    ];
    expect(planInstall(entries, new Set(entries.map(abs)), scope)).toEqual({
      reuse: [],
      fetch: entries,
    });
  });

  it("splits a mixed manifest and keeps order", () => {
    const entries = [
      "index.html",
      "assets/a-AAAAAAAA.js",
      "assets/b-BBBBBBBB.css",
      "icons/icon-192.png",
    ];
    const cached = new Set(
      ["index.html", "assets/a-AAAAAAAA.js", "icons/icon-192.png"].map(abs),
    );
    expect(planInstall(entries, cached, scope)).toEqual({
      reuse: ["assets/a-AAAAAAAA.js"],
      fetch: ["index.html", "assets/b-BBBBBBBB.css", "icons/icon-192.png"],
    });
  });
});
