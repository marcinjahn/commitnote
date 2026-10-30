import { describe, expect, it } from "vitest";
import type { NoteVersion, VersionEvent } from "./note-history";
import {
  buildVersionSections,
  newestOfRow,
  type VersionRow,
} from "./version-sections";

const MINUTE = 60_000;
const NOON = Date.UTC(2026, 8, 12, 12);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function version(
  sha: string,
  committedAt: number,
  events: VersionEvent[] = [],
): NoteVersion {
  return { sha, committedAt, storedPath: "n", name: "Note", events };
}

function shapes(rows: readonly VersionRow[]): string[] {
  return rows.map((row) =>
    row.kind === "single"
      ? `${row.current ? "current:" : ""}${row.version.sha}`
      : `session:${row.versions.map((v) => v.sha).join("+")}`,
  );
}

describe("buildVersionSections", () => {
  it("returns nothing for an empty list", () => {
    expect(buildVersionSections([])).toEqual([]);
  });

  it("makes the newest version a current row of its own", () => {
    const sections = buildVersionSections(
      [version("b", NOON + MINUTE), version("a", NOON)],
      utcDay,
    );
    expect(sections).toHaveLength(1);
    expect(shapes(sections[0]!.rows)).toEqual(["current:b", "a"]);
  });

  it("groups older edit-only saves into session rows", () => {
    const sections = buildVersionSections(
      [
        version("d", NOON + 3 * MINUTE),
        version("c", NOON + 2 * MINUTE),
        version("b", NOON + MINUTE),
        version("a", NOON),
      ],
      utcDay,
    );
    expect(shapes(sections[0]!.rows)).toEqual(["current:d", "session:c+b+a"]);
  });

  it("splits rows into sections by local day of the newest version", () => {
    const midnight = new Date(2026, 8, 13).getTime();
    const sections = buildVersionSections([
      version("c", midnight + MINUTE),
      version("b", midnight - MINUTE, ["external"]),
      version("a", midnight - 2 * MINUTE, ["external"]),
    ]);
    expect(sections.map((section) => shapes(section.rows))).toEqual([
      ["current:c"],
      ["b", "a"],
    ]);
    expect(sections[0]!.day).toBe(new Date(2026, 8, 13).getTime());
    expect(sections[1]!.day).toBe(new Date(2026, 8, 12).getTime());
  });
});

describe("newestOfRow", () => {
  it("is the version of a single row and the first of a session", () => {
    const a = version("a", NOON);
    const b = version("b", NOON + MINUTE);
    expect(newestOfRow({ kind: "single", version: a, current: false })).toBe(a);
    expect(newestOfRow({ kind: "session", versions: [b, a] })).toBe(b);
  });
});
