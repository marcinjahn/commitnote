import { describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import type { SearchSource } from "../sync/search-source";
import type { IndexerState } from "./content-indexer";
import { matchContents, matchNames } from "./search-ranking";
import {
  contentRows,
  isPartial,
  nameRows,
  recentRows,
  resultCountText,
  rowView,
  searchProgress,
} from "./search-results";
import { indexContent, parseTerms } from "./search-text";

function source(path: string, text = "", colorTag: SearchSource["colorTag"] = null): SearchSource {
  const segments: NotePath = path.split("/");
  return {
    path: segments,
    name: segments[segments.length - 1]!,
    colorTag,
    content: { kind: "local", text },
  };
}

const state = (status: IndexerState["status"]): IndexerState => ({ status, unreadable: 0 });

describe("recentRows", () => {
  const sources = [source("A"), source("F/B"), source("C")];

  it("keeps recent order and skips missing notes and the current note", () => {
    const rows = recentRows([["C"], ["gone"], ["F", "B"], ["A"]], ["A"], sources);
    expect(rows.map((row) => row.key)).toEqual([JSON.stringify(["C"]), JSON.stringify(["F", "B"])]);
  });

  it("carries no highlight ranges", () => {
    const [row] = recentRows([["F", "B"]], null, sources);
    expect(rowView(row!)).toMatchObject({
      name: "B",
      nameRanges: [],
      folders: [{ text: "F", ranges: [] }],
      snippet: null,
    });
  });
});

describe("name and content rows", () => {
  const sources = [source("Docs/Road map", "x", "red"), source("Other", "drive the road")];
  const terms = parseTerms("road");

  it("shapes name matches", () => {
    const rows = nameRows(matchNames(sources, terms));
    expect(rows).toHaveLength(1);
    const view = rowView(rows[0]!);
    expect(view.path).toEqual(["Docs", "Road map"]);
    expect(view.colorTag).toBe("red");
    expect(view.nameRanges.length).toBeGreaterThan(0);
    expect(view.folders).toEqual([{ text: "Docs", ranges: [] }]);
    expect(view.snippet).toBeNull();
  });

  it("shapes content matches with a snippet", () => {
    const section = matchContents(sources, terms, (s) =>
      indexContent(s.content.kind === "local" ? s.content.text : ""),
    );
    const view = rowView(contentRows(section)[0]!);
    expect(view.path).toEqual(["Other"]);
    expect(view.snippet?.text).toContain("road");
    expect(view.snippet?.ranges.length).toBeGreaterThan(0);
  });
});

describe("resultCountText", () => {
  it("is empty without terms or before the contents settle", () => {
    expect(resultCountText(false, true, 3)).toBe("");
    expect(resultCountText(true, false, 3)).toBe("");
  });

  it("describes the count once settled", () => {
    expect(resultCountText(true, true, 0)).toBe("No matches");
    expect(resultCountText(true, true, 1)).toBe("1 result");
    expect(resultCountText(true, true, 2)).toBe("2 results");
  });
});

describe("searchProgress and isPartial", () => {
  it("reports a ratio only while indexing something", () => {
    expect(searchProgress(state({ kind: "indexing", done: 1, total: 4 }))).toBe(0.25);
    expect(searchProgress(state({ kind: "indexing", done: 0, total: 0 }))).toBeNull();
    expect(searchProgress(state({ kind: "complete" }))).toBeNull();
  });

  it("is partial unless complete", () => {
    expect(isPartial(state({ kind: "complete" }))).toBe(false);
    expect(isPartial(state({ kind: "idle" }))).toBe(true);
    expect(isPartial(state({ kind: "offline" }))).toBe(true);
  });
});
