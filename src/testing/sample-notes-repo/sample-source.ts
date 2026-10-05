import type { ColorTag } from "../../tags/color-tag";

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

export interface SampleTrashEntry {
  readonly path: readonly string[];
  readonly kind: "note" | "folder";
  readonly deletedAt: string;
}

export const SAMPLE_TRASH_NOW = "2026-09-30T12:00:00.000Z";

export const sampleTrashRepoSource: readonly SampleEntry[] = [
  {
    kind: "note",
    name: "Welcome",
    markdown: "# Welcome\n\nA notes repo with a populated trash.\n",
  },
  {
    kind: "folder",
    name: "Archive",
    children: [
      {
        kind: "note",
        name: "Kept note",
        markdown: "# Kept note\n\nStays in the tree.\n",
      },
      {
        kind: "note",
        name: "Old meeting",
        markdown: "# Old meeting\n\nExpired note in the trash.\n",
      },
    ],
  },
  {
    kind: "folder",
    name: "Drafts",
    children: [
      {
        kind: "note",
        name: "Outline",
        markdown: "# Outline\n\nNested note in an expired folder.\n",
      },
    ],
  },
  {
    kind: "note",
    name: "Scratch",
    markdown: "# Scratch\n\nFresh note in the trash.\n",
  },
];

export const sampleTrashRepoTrashed: readonly SampleTrashEntry[] = [
  {
    path: ["Archive", "Old meeting"],
    kind: "note",
    deletedAt: "2026-01-05T09:00:00.000Z",
  },
  {
    path: ["Drafts"],
    kind: "folder",
    deletedAt: "2026-01-12T10:30:00.000Z",
  },
  {
    path: ["Scratch"],
    kind: "note",
    deletedAt: "2026-09-27T08:15:00.000Z",
  },
];

export interface SampleFolderOrder {
  readonly parent: readonly string[];
  readonly names: readonly string[];
}

export const sampleNotesRepoOrder: readonly SampleFolderOrder[] = [
  { parent: ["Projects", "commitnote"], names: ["Roadmap", "Ideas"] },
];

export interface SampleTag {
  readonly path: readonly string[];
  readonly color: ColorTag;
}

export const sampleNotesRepoTags: readonly SampleTag[] = [
  { path: ["Projects", "commitnote", "Ideas"], color: "green" },
  { path: ["Projects", "commitnote", "Roadmap"], color: "blue" },
  { path: ["Journal", "2026", "January"], color: "orange" },
  { path: ["Zażółć gęślą jaźń"], color: "purple" },
];
