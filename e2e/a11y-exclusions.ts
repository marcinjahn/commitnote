import type { A11yState } from "./helpers/a11y";

export interface A11yExclusion {
  finding: string;
  rule: string;
  states: readonly A11yState[];
  target?: string;
  projects?: readonly string[];
}

const NOTES_STATES = [
  "commands-menu",
  "error-toast",
  "note",
  "row-menu",
  "tree",
  "windows-commands-menu",
] as const satisfies readonly A11yState[];

export const A11Y_EXCLUSIONS: readonly A11yExclusion[] = [
  {
    finding: "A11Y-01",
    rule: "aria-required-children",
    states: NOTES_STATES,
    target: ".tree",
  },
  {
    finding: "A11Y-NEW-4",
    rule: "landmark-one-main",
    states: ["commands-menu", "tree"],
    projects: ["mobile"],
  },
  {
    finding: "A11Y-04",
    rule: "list",
    states: ["trash"],
    target: ".trash-list",
  },
  {
    finding: "A11Y-06",
    rule: "color-contrast",
    states: ["history"],
    target: ".badge",
  },
  {
    finding: "A11Y-07",
    rule: "color-contrast",
    states: ["search-results"],
    target: ".option-snippet > mark",
  },
];
