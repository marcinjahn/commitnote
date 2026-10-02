import { describe, expect, it } from "vitest";
import { groupVersions, SESSION_GAP_MS } from "./group-versions";
import type { NoteVersion, VersionEvent } from "./note-history";

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

function shas(versions: NoteVersion[]): string[][] {
  return groupVersions(versions, utcDay).map((group) =>
    group.versions.map((v) => v.sha),
  );
}

describe("groupVersions", () => {
  it("groups edits saved at most ten minutes apart into one session", () => {
    expect(
      shas([
        version("c", NOON + 2 * SESSION_GAP_MS),
        version("b", NOON + SESSION_GAP_MS),
        version("a", NOON),
      ]),
    ).toEqual([["c", "b", "a"]]);
  });

  it("starts a new session after a longer pause", () => {
    expect(
      shas([version("b", NOON + SESSION_GAP_MS + 1), version("a", NOON)]),
    ).toEqual([["b"], ["a"]]);
  });

  it("starts a new session on another day", () => {
    const midnight = Date.UTC(2026, 8, 13);
    expect(
      shas([version("b", midnight + MINUTE), version("a", midnight - MINUTE)]),
    ).toEqual([["b"], ["a"]]);
  });

  it("keeps versions with events on rows of their own", () => {
    expect(
      shas([
        version("d", NOON + 3 * MINUTE),
        version("c", NOON + 2 * MINUTE, ["renamed"]),
        version("b", NOON + MINUTE),
        version("a", NOON, ["created"]),
      ]),
    ).toEqual([["d"], ["c"], ["b"], ["a"]]);
  });

  it("returns no rows for no versions", () => {
    expect(groupVersions([])).toEqual([]);
  });
});
