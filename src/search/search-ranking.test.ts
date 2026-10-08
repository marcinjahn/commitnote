import { describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import type { SearchSource } from "../sync/search-source";
import { matchContents, matchNames } from "./search-ranking";
import { indexContent, parseTerms, type IndexedContent } from "./search-text";
import { RESULT_CAP, SNIPPET_LEAD, SNIPPET_LENGTH } from "./search-tuning";

function source(path: string, text = ""): SearchSource {
  const segments: NotePath = path.split("/");
  return {
    path: segments,
    name: segments[segments.length - 1],
    colorTag: null,
    content: { kind: "local", text },
  };
}

function contents(sources: readonly SearchSource[]) {
  const map = new Map(
    sources.map((s) => [s, indexContent(s.content.kind === "local" ? s.content.text : "")]),
  );
  return (s: SearchSource): IndexedContent | undefined => map.get(s);
}

function names(query: string, sources: readonly SearchSource[]) {
  return matchNames(sources, parseTerms(query)).matches.map((m) => m.source.path.join("/"));
}

function contentMatches(query: string, sources: readonly SearchSource[]) {
  return matchContents(sources, parseTerms(query), contents(sources));
}

describe("empty terms", () => {
  it("returns empty sections", () => {
    const sources = [source("Alpha")];
    expect(matchNames(sources, [])).toEqual({ matches: [], more: false });
    expect(matchContents(sources, [], contents(sources))).toEqual({ matches: [], more: false });
  });
});

describe("matchNames", () => {
  it("orders tiers exact, prefix, word start, substring", () => {
    const sources = [
      source("xxroad"),
      source("My road trip"),
      source("Roadmap"),
      source("Road"),
    ];
    expect(names("road", sources)).toEqual(["Road", "Roadmap", "My road trip", "xxroad"]);
  });

  it("matches an exact name for multiple terms joined by spaces", () => {
    const sources = [source("Road map notes"), source("Road map")];
    expect(names("road map", sources)).toEqual(["Road map", "Road map notes"]);
  });

  it("puts all-in-name matches before ones that needed a folder within a tier", () => {
    const sources = [source("Projects/Roadmap"), source("Roadmap Projects"), source("Zeta/Roadmap")];
    expect(names("roadmap projects", sources)).toEqual([
      "Roadmap Projects",
      "Projects/Roadmap",
    ]);
    expect(names("roadmap", [source("A/Roadmap"), source("Roadmap")])).toEqual([
      "A/Roadmap",
      "Roadmap",
    ]);
    expect(names("road proj", [source("Projects/Roadmap"), source("Road project")])).toEqual([
      "Road project",
      "Projects/Roadmap",
    ]);
  });

  it("breaks ties by name then path", () => {
    const sources = [source("B/Note"), source("A/Note"), source("Note2")];
    expect(names("note", sources)).toEqual(["A/Note", "B/Note", "Note2"]);
  });

  it("narrows by folder words", () => {
    const sources = [source("Projects/commitnote/Roadmap"), source("Other/Roadmap")];
    expect(names("proj road", sources)).toEqual(["Projects/commitnote/Roadmap"]);
  });

  it("excludes folder-only matches", () => {
    expect(names("projects", [source("Projects/Roadmap")])).toEqual([]);
  });

  it("matches diacritics-insensitively", () => {
    expect(names("zazolc", [source("Zażółć")])).toEqual(["Zażółć"]);
    expect(names("zażółć", [source("Zazolc")])).toEqual(["Zazolc"]);
  });

  it("highlights every occurrence of every term, merged", () => {
    const [match] = matchNames([source("Projects/Road road map")], parseTerms("road map")).matches;
    expect(match.nameRanges).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
      { start: 10, end: 13 },
    ]);
    expect(match.folderRanges).toEqual([[]]);
  });

  it("highlights folder segments", () => {
    const [match] = matchNames([source("Projects/Roadmap")], parseTerms("proj road")).matches;
    expect(match.folderRanges).toEqual([[{ start: 0, end: 4 }]]);
    expect(match.nameRanges).toEqual([{ start: 0, end: 4 }]);
  });

  it("caps at the result cap and reports more", () => {
    const many = Array.from({ length: RESULT_CAP + 5 }, (_, i) =>
      source(`Note ${String(i).padStart(3, "0")}`),
    );
    const section = matchNames(many, parseTerms("note"));
    expect(section.matches).toHaveLength(RESULT_CAP);
    expect(section.more).toBe(true);
    expect(matchNames(many.slice(0, RESULT_CAP), parseTerms("note")).more).toBe(false);
  });
});

describe("matchContents", () => {
  it("excludes name matches", () => {
    const sources = [source("Roadmap", "road"), source("Other", "road")];
    const section = contentMatches("road", sources);
    expect(section.matches.map((m) => m.source.name)).toEqual(["Other"]);
  });

  it("requires every term in the content", () => {
    const sources = [source("A", "alpha beta"), source("B", "alpha only")];
    expect(contentMatches("alpha beta", sources).matches.map((m) => m.source.name)).toEqual(["A"]);
  });

  it("orders by capped occurrence count then name", () => {
    const sources = [
      source("Few", "foo"),
      source("Many", "foo ".repeat(30)),
      source("Capped", "foo ".repeat(12)),
      source("Also few", "foo"),
    ];
    expect(contentMatches("foo", sources).matches.map((m) => m.source.name)).toEqual([
      "Capped",
      "Many",
      "Also few",
      "Few",
    ]);
  });

  it("skips notes without content", () => {
    const sources = [source("A", "foo"), source("B", "foo")];
    const section = matchContents(sources, ["foo"], (s) =>
      s.name === "A" ? indexContent("foo") : undefined,
    );
    expect(section.matches.map((m) => m.source.name)).toEqual(["A"]);
  });

  it("matches diacritics-insensitively", () => {
    const section = contentMatches("zazolc", [source("A", "Zażółć")]);
    expect(section.matches[0].snippet).toEqual({ text: "Zażółć", ranges: [{ start: 0, end: 6 }] });
  });

  it("carries name highlights for partial name occurrences", () => {
    const [match] = contentMatches("foo bar", [source("Foo", "foo bar")]).matches;
    expect(match.nameRanges).toEqual([{ start: 0, end: 3 }]);
  });

  it("builds a snippet at the start without a leading ellipsis", () => {
    const text = "hello world " + "x".repeat(300);
    const [match] = contentMatches("hello", [source("A", text)]).matches;
    expect(match.snippet.text.startsWith("hello world")).toBe(true);
    expect(match.snippet.text.endsWith("…")).toBe(true);
    expect(match.snippet.text).toHaveLength(SNIPPET_LENGTH + 1);
    expect(match.snippet.ranges).toEqual([{ start: 0, end: 5 }]);
  });

  it("builds a snippet in the middle with both ellipses", () => {
    const text = "a".repeat(100) + " needle " + "b".repeat(300);
    const [match] = contentMatches("needle", [source("A", text)]).matches;
    const snippet = match.snippet;
    expect(snippet.text.startsWith("…")).toBe(true);
    expect(snippet.text.endsWith("…")).toBe(true);
    const { start, end } = snippet.ranges[0];
    expect(snippet.text.slice(start, end)).toBe("needle");
    expect(start).toBe(1 + SNIPPET_LEAD);
  });

  it("builds a snippet at the end without a trailing ellipsis", () => {
    const text = "a".repeat(300) + " needle end";
    const [match] = contentMatches("needle", [source("A", text)]).matches;
    const snippet = match.snippet;
    expect(snippet.text.startsWith("…")).toBe(true);
    expect(snippet.text.endsWith("needle end")).toBe(true);
    const { start, end } = snippet.ranges[0];
    expect(snippet.text.slice(start, end)).toBe("needle");
  });

  it("collapses whitespace and newlines and keeps ranges aligned", () => {
    const text = "  \n\n first   line\n\n  needle \t here  \n";
    const [match] = contentMatches("needle here", [source("A", text)]).matches;
    expect(match.snippet.text).toBe("first line needle here");
    expect(match.snippet.ranges).toEqual([
      { start: 11, end: 17 },
      { start: 18, end: 22 },
    ]);
  });

  it("highlights multiple terms and clips ranges to the window", () => {
    const text = "alpha " + "x ".repeat(100) + "beta alpha";
    const [match] = contentMatches("alpha beta", [source("A", text)]).matches;
    const snippet = match.snippet;
    const highlighted = snippet.ranges.map((r) => snippet.text.slice(r.start, r.end));
    expect(highlighted).toEqual(["alpha"]);
    const clipped = contentMatches("ab", [source("A", "x".repeat(SNIPPET_LEAD) + "ab")]);
    expect(clipped.matches[0].snippet.ranges).toEqual([
      { start: SNIPPET_LEAD, end: SNIPPET_LEAD + 2 },
    ]);
  });

  it("caps at the result cap and reports more", () => {
    const many = Array.from({ length: RESULT_CAP + 1 }, (_, i) => source(`N${i}`, "foo"));
    const section = contentMatches("foo", many);
    expect(section.matches).toHaveLength(RESULT_CAP);
    expect(section.more).toBe(true);
  });
});
