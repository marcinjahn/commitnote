import { describe, expect, it } from "vitest";
import { sharedMemoizedArgon2id } from "../../crypto/testing/shared-argon2id";
import { generateLargeTreeRepo } from "./generate-sample-notes-repo";
import { largeTreeSource } from "./large-tree-source";
import type { SampleEntry } from "./sample-source";

interface Stats {
  notes: number;
  depth: number;
  names: string[];
}

function measure(entries: readonly SampleEntry[], depth: number, stats: Stats) {
  for (const entry of entries) {
    stats.names.push(entry.name);
    if (entry.kind === "note") {
      stats.notes += 1;
    } else {
      stats.depth = Math.max(stats.depth, depth + 1);
      measure(entry.children, depth + 1, stats);
    }
  }
}

describe("largeTreeSource", () => {
  const stats: Stats = { notes: 0, depth: 0, names: [] };
  measure(largeTreeSource(), 0, stats);

  it("holds at least 600 notes", () => {
    expect(stats.notes).toBeGreaterThanOrEqual(600);
  });

  it("nests folders at least 3 levels deep", () => {
    expect(stats.depth).toBeGreaterThanOrEqual(3);
  });

  it("mixes one-word names with names of 60 or more characters", () => {
    expect(stats.names.some((name) => !name.includes(" "))).toBe(true);
    expect(stats.names.some((name) => name.length >= 60)).toBe(true);
  });

  it("is deterministic", () => {
    expect(largeTreeSource()).toEqual(largeTreeSource());
  });
});

describe("generateLargeTreeRepo", () => {
  it("generates identical commits twice", async () => {
    const first = await generateLargeTreeRepo(sharedMemoizedArgon2id);
    const second = await generateLargeTreeRepo(sharedMemoizedArgon2id);
    expect(second).toEqual(first);
  }, 60_000);
});
