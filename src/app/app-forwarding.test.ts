import { describe, expect, it } from "vitest";
import { appForwardingTarget } from "../../landing/src/forwarding";
import { isShareHash } from "../share/share-link";
import { isNoteFragment } from "./note-fragment";
import { parseLaunchAction } from "./launch-action";

const HASHES = [
  "",
  "#",
  "#share=",
  "#share=1.gh.abc.def",
  "#sharex",
  "#share",
  "#Share=1",
  "#n=",
  "#n=AAAA",
  "#n",
  "#note=abc",
  "#N=AAAA",
  "#action=search",
  "#how-it-works",
  "#main",
];

const SEARCHES = [
  "",
  "?",
  "?action=new-note",
  "?action=search",
  "?action=",
  "?action=delete",
  "?action=New-Note",
  "?action=search&action=delete",
  "?x=1&action=search",
  "?fake-forge-session=x",
  "?actions=search",
];

describe("landing app forwarding matches the app", () => {
  it.each(HASHES)("hash %j", (hash) => {
    expect(
      appForwardingTarget({ pathname: "/", search: "", hash }, false) !== null,
    ).toBe(isShareHash(hash) || isNoteFragment(hash));
  });

  it.each(SEARCHES)("query %j", (search) => {
    expect(
      appForwardingTarget({ pathname: "/", search, hash: "" }, false) !== null,
    ).toBe(parseLaunchAction("https://x.test/" + search) !== null);
  });
});
