import { describe, expect, it } from "vitest";
import type { VersionContent } from "./note-history";
import { planRestore, titleDiffers, type RestoreInput } from "./plan-restore";

const CURRENT = { content: "now", name: "Hello" };
const OLD: VersionContent = {
  kind: "readable",
  content: "then",
  name: "Welcome",
};

function input(overrides: Partial<RestoreInput> = {}): RestoreInput {
  return {
    current: CURRENT,
    version: OLD,
    restoreTitle: false,
    conflicted: false,
    canSave: true,
    ...overrides,
  };
}

describe("planRestore", () => {
  it("restores only the content unless the title is asked for", () => {
    expect(planRestore(input())).toEqual({
      kind: "ready",
      content: "then",
      name: null,
    });
  });

  it("restores the content and the title", () => {
    expect(planRestore(input({ restoreTitle: true }))).toEqual({
      kind: "ready",
      content: "then",
      name: "Welcome",
    });
  });

  it("restores only the title when the content is the same", () => {
    expect(
      planRestore(
        input({
          version: { kind: "readable", content: "now", name: "Welcome" },
          restoreTitle: true,
        }),
      ),
    ).toEqual({ kind: "ready", content: null, name: "Welcome" });
  });

  it("is blocked when nothing would change", () => {
    const same: VersionContent = {
      kind: "readable",
      content: "now",
      name: "Welcome",
    };
    expect(planRestore(input({ version: same }))).toEqual({
      kind: "blocked",
      reason: "same",
    });
    expect(
      planRestore(
        input({
          version: { kind: "readable", content: "now", name: "Hello" },
          restoreTitle: true,
        }),
      ),
    ).toEqual({ kind: "blocked", reason: "same" });
  });

  it("ignores the title checkbox when the version's name is unknown", () => {
    expect(
      planRestore(
        input({
          version: { kind: "readable", content: "then", name: null },
          restoreTitle: true,
        }),
      ),
    ).toEqual({ kind: "ready", content: "then", name: null });
  });

  it.each([
    ["gone", { current: null }],
    ["conflicted", { conflicted: true }],
    ["unavailable", { canSave: false }],
    ["loading", { version: null }],
    ["unreadable", { version: { kind: "failed", error: { kind: "network" } } }],
    ["undecryptable", { version: { kind: "undecryptable", name: "Welcome" } }],
  ] as const)("is blocked when %s", (reason, overrides) => {
    expect(planRestore(input(overrides as Partial<RestoreInput>))).toEqual({
      kind: "blocked",
      reason,
    });
  });

  it("names a missing note before any other reason", () => {
    expect(
      planRestore(input({ current: null, conflicted: true, version: null })),
    ).toEqual({ kind: "blocked", reason: "gone" });
  });
});

describe("titleDiffers", () => {
  it("is true only for a known, different name", () => {
    expect(titleDiffers(OLD, "Hello")).toBe(true);
    expect(titleDiffers(OLD, "Welcome")).toBe(false);
    expect(
      titleDiffers({ kind: "readable", content: "", name: null }, "Hello"),
    ).toBe(false);
    expect(
      titleDiffers({ kind: "undecryptable", name: "Welcome" }, "Hello"),
    ).toBe(true);
    expect(titleDiffers(null, "Hello")).toBe(false);
  });
});
