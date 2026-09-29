export const SAMPLE_NOTES_REPO_PASSPHRASE = "sample notes repo passphrase";

export type SampleEntry =
  | {
      readonly kind: "folder";
      readonly name: string;
      readonly children: readonly SampleEntry[];
    }
  | { readonly kind: "note"; readonly name: string; readonly markdown: string };

const WELCOME_MARKDOWN = [
  "# Welcome",
  "",
  "This is your **notes** repo, encrypted end to end. Some *emphasis*, ~~strikethrough~~, and `inline code`.",
  "",
  "```js",
  'console.log("hello");',
  "```",
  "",
  "See the [commitnote project](https://github.com/example/commitnote) for details.",
  "",
  "> Notes stay private even to the forge that hosts them.",
  "",
  "- First bullet",
  "- Second bullet",
  "",
  "1. First step",
  "2. Second step",
  "",
  "- [x] Done task",
  "- [ ] Open task",
  "",
  "| Column A | Column B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
].join("\n");

const IDEAS_MARKDOWN = [
  "# Ideas",
  "",
  "- Add offline sync",
  "- Support multiple repos",
  "",
].join("\n");

const ROADMAP_MARKDOWN = [
  "# Roadmap",
  "",
  "1. Ship v1",
  "2. Add mobile client",
  "",
].join("\n");

const JANUARY_MARKDOWN = [
  "# January",
  "",
  "Started the commitnote project this month.",
  "",
].join("\n");

const ZAZOLC_MARKDOWN = [
  "# Zażółć gęślą jaźń",
  "",
  "Testing non-ASCII note names end to end.",
  "",
].join("\n");

export const sampleNotesRepoSource: readonly SampleEntry[] = [
  { kind: "note", name: "Welcome", markdown: WELCOME_MARKDOWN },
  {
    kind: "folder",
    name: "Projects",
    children: [
      {
        kind: "folder",
        name: "commitnote",
        children: [
          { kind: "note", name: "Ideas", markdown: IDEAS_MARKDOWN },
          { kind: "note", name: "Roadmap", markdown: ROADMAP_MARKDOWN },
        ],
      },
    ],
  },
  {
    kind: "folder",
    name: "Journal",
    children: [
      {
        kind: "folder",
        name: "2026",
        children: [
          { kind: "note", name: "January", markdown: JANUARY_MARKDOWN },
        ],
      },
    ],
  },
  { kind: "folder", name: "Empty folder", children: [] },
  { kind: "note", name: "Zażółć gęślą jaźń", markdown: ZAZOLC_MARKDOWN },
];
