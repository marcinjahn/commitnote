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

const MEETING_MINUTES_PARAGRAPHS: readonly string[] = [
  "Attendees joined a little after ten and agreed to keep the agenda short. The first item was a recap of last sprint: the sync engine now survives flaky connections, and the remaining rough edges are mostly cosmetic. Nobody raised blocking issues, so the group moved on quickly to the next topic. A few people asked for more time to read the notes before the meetings, so the agenda will be circulated the evening before from now on.",
  "Second item: the sidebar. Folders should remember whether they were expanded, and the tree should keep its scroll position when a note is renamed. A volunteer will prototype both changes during the coming week and report back with a short demo and a list of open questions.",
  "Notes on tagging: colour tags should stay visible in every list, including narrow screens, and the palette must remain readable in both light and dark themes. Contrast was checked for the three darkest colours and found acceptable, though the yellow still needs a second look on small displays under bright sunlight.",
  "Notes on sharing: a shared note keeps its link until the owner revokes it, and revoking has to be obvious and reversible only by creating a new link. The group agreed that the confirmation wording should explain what recipients will see afterwards, without any technical vocabulary at all.",
  "Third item: offline behaviour. Edits made without a connection are queued and replayed in order once the network returns. The team discussed what should happen when two devices change the same note, and decided that the later save wins but the earlier text stays recoverable from history.",
  "Fourth item: accessibility. Keyboard focus must never disappear after closing a dialog, and every icon-only button needs a readable label. A short checklist will be added to the review template so these points are verified before a change is merged.",
  "Somewhere in the middle of the discussion a kingfisher was mentioned as the mascot candidate for the next release, mostly because someone had photographed one on the way to the office. The idea got a few smiles and was parked for later.",
  "Fifth item: performance on large repositories. Loading the tree should stay responsive with thousands of notes, so heavy work has to happen in small slices that yield to the interface. Measurements will be gathered on a deliberately oversized sample repository.",
  "Fifth-and-a-half item: error messages. Every failure shown to a person must say what happened and what to try next, in plain language, and must never include anything typed or stored by the person. Existing messages will be reviewed one by one, and the vaguest ones rewritten before the next release candidate.",
  "Fifth-and-three-quarters item: mobile layout. The toolbar wraps awkwardly on the narrowest phones, and the bottom sheet covers the keyboard in landscape mode. Both problems were reproduced during the meeting, and a small fix with matching screenshots is expected within a few working days.",
  "Sixth item: documentation. The onboarding page still describes the old login flow, and the screenshots are outdated. Two people will rewrite it and ask a newcomer to follow the steps without any help, noting every place where they hesitate.",
  "Seventh item: housekeeping. Dependencies get updated on the first Monday of the month, release branches are cut on Thursdays, and the changelog is written by whoever merges the final change of the release. Nothing here changed compared to the previous quarter.",
  "Closing remarks: the next meeting takes place in two weeks, same time, same room. Action items were assigned in the shared tracker, and everyone promised to update their status before the end of the week so the follow-up can be brief. Anyone who cannot attend should send their updates in writing beforehand, so that nothing is blocked while waiting for answers.",
];

const MEETING_MINUTES_MARKDOWN = [
  "# Meeting minutes",
  "",
  ...MEETING_MINUTES_PARAGRAPHS.flatMap((paragraph) => [paragraph, ""]),
].join("\n");

export const sampleSearchRepoSource: readonly SampleEntry[] = [
  {
    kind: "folder",
    name: "Journal",
    children: [
      {
        kind: "folder",
        name: "2026",
        children: [
          {
            kind: "note",
            name: "February",
            markdown:
              "# February\n\nSaw the old lighthouse on the way home. Planned the next roadmap meeting.\n",
          },
          {
            kind: "note",
            name: "January",
            markdown:
              "# January\n\nBaked sourdough on the first weekend and finished a lighthouse puzzle.\n",
          },
        ],
      },
      {
        kind: "folder",
        name: "Trips",
        children: [
          {
            kind: "note",
            name: "Lisbon",
            markdown:
              "# Lisbon\n\nTook the bus to see the lighthouse at Cabo da Roca.\n",
          },
        ],
      },
    ],
  },
  {
    kind: "folder",
    name: "Projects",
    children: [
      {
        kind: "folder",
        name: "commitnote",
        children: [
          {
            kind: "note",
            name: "Ideas",
            markdown: "# Ideas\n\nSearch by name first, then by content.\n",
          },
          {
            kind: "note",
            name: "Meeting minutes",
            markdown: MEETING_MINUTES_MARKDOWN,
          },
          {
            kind: "note",
            name: "Release checklist",
            markdown:
              "# Release checklist\n\nWrite the release notes. Try the search palette once more.\n",
          },
          {
            kind: "note",
            name: "Roadmap",
            markdown:
              "# Roadmap\n\n1. Search across notes\n2. Offline mode\n",
          },
        ],
      },
      {
        kind: "folder",
        name: "Garden",
        children: [
          {
            kind: "note",
            name: "Planting plan",
            markdown:
              "# Planting plan\n\nTomatoes and basil go in the sunny bed. Start a compost heap.\n",
          },
        ],
      },
      {
        kind: "note",
        name: "Old roadmap",
        markdown:
          "# Old roadmap\n\nObserve the quasar from the rooftop before the move.\n",
      },
    ],
  },
  {
    kind: "folder",
    name: "Recipes",
    children: [
      {
        kind: "note",
        name: "Pierogi",
        markdown: "# Pierogi\n\nFill with ruskie, or with twaróg and potatoes.\n",
      },
      {
        kind: "note",
        name: "Sourdough bread",
        markdown:
          "# Sourdough bread\n\nFeed the starter the night before. Bake the sourdough in a hot pot.\n",
      },
    ],
  },
  {
    kind: "note",
    name: "Reading list",
    markdown: "# Reading list\n\n- The Lighthouse Keeper\n",
  },
  {
    kind: "note",
    name: "Welcome",
    markdown: "# Welcome\n\nTry searching for lighthouse.\n",
  },
  {
    kind: "note",
    name: "Zażółć gęślą jaźń",
    markdown:
      "# Zażółć gęślą jaźń\n\nPchnąć w tę łódź jeża lub ośm skrzyń fig.\n",
  },
];

export const sampleSearchRepoTags: readonly SampleTag[] = [
  { path: ["Journal", "2026", "January"], color: "orange" },
  { path: ["Projects", "commitnote", "Release checklist"], color: "green" },
  { path: ["Projects", "commitnote", "Roadmap"], color: "blue" },
  { path: ["Projects", "Garden", "Planting plan"], color: "green" },
  { path: ["Recipes", "Pierogi"], color: "red" },
  { path: ["Recipes", "Sourdough bread"], color: "yellow" },
  { path: ["Reading list"], color: "blue" },
  { path: ["Zażółć gęślą jaźń"], color: "purple" },
];

export const sampleSearchRepoTrashed: readonly SampleTrashEntry[] = [
  {
    path: ["Projects", "Old roadmap"],
    kind: "note",
    deletedAt: "2026-09-28T08:00:00.000Z",
  },
];
