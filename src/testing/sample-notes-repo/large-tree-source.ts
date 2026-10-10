import { createSeededRandom } from "./seeded-random";
import type { SampleEntry } from "./sample-source";

export const LARGE_TREE_REPO_KEY = "sample/large-tree";

const SOURCE_SEED = 0x74726565;
const TOP_LEVEL_FOLDERS = 12;
const ROOT_NOTES = 12;
const LONG_NAME_LENGTH = 60;

const WORDS = [
  "alpha", "archive", "budget", "calendar", "checklist", "client", "design",
  "draft", "energy", "garden", "history", "ideas", "inventory", "journal",
  "kitchen", "launch", "meeting", "migration", "notes", "outline", "planning",
  "project", "quarterly", "reading", "recipe", "research", "review", "roadmap",
  "schedule", "summary", "travel", "weekly", "workshop", "retrospective",
  "onboarding", "documentation", "architecture", "performance", "accessibility",
];

function createPicker(seed: number) {
  const random = createSeededRandom(seed);
  const below = (limit: number): number => {
    const bytes = random(4);
    const value =
      (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
    return value % limit;
  };
  return {
    below,
    word: (): string => WORDS[below(WORDS.length)],
  };
}

type Picker = ReturnType<typeof createPicker>;

function title(words: readonly string[]): string {
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function uniqueName(picker: Picker, taken: Set<string>): string {
  for (;;) {
    const words = [picker.word()];
    if (picker.below(4) === 0) {
      while (words.join(" ").length < LONG_NAME_LENGTH) {
        words.push(picker.word());
      }
    } else if (picker.below(2) === 0) {
      words.push(picker.word());
    }
    const name = title(words);
    const key = name.toLowerCase();
    if (!taken.has(key)) {
      taken.add(key);
      return name;
    }
  }
}

function notes(picker: Picker, taken: Set<string>, count: number): SampleEntry[] {
  return Array.from({ length: count }, (): SampleEntry => {
    const name = uniqueName(picker, taken);
    return {
      kind: "note",
      name,
      markdown: `# ${name.slice(0, 40)}\n\n${title([picker.word(), picker.word(), picker.word()])}.\n`,
    };
  });
}

function folder(
  picker: Picker,
  taken: Set<string>,
  depth: number,
  noteCount: number,
  subfolderCount: number,
): SampleEntry {
  const name = uniqueName(picker, taken);
  const inner = new Set<string>();
  const children: SampleEntry[] = [];
  for (let i = 0; i < subfolderCount; i++) {
    children.push(
      folder(picker, inner, depth + 1, 6, depth < 2 && i === 0 ? 2 : 0),
    );
  }
  children.push(...notes(picker, inner, noteCount));
  return { kind: "folder", name, children };
}

export function largeTreeSource(): readonly SampleEntry[] {
  const picker = createPicker(SOURCE_SEED);
  const rootNames = new Set<string>();
  const entries: SampleEntry[] = [];

  for (let i = 0; i < TOP_LEVEL_FOLDERS; i++) {
    const name = uniqueName(picker, rootNames);
    const inner = new Set<string>();
    const subfolders = 2 + (i % 3);
    const children: SampleEntry[] = [];
    for (let j = 0; j < subfolders; j++) {
      children.push(folder(picker, inner, 1, 12, j % 3 === 0 ? 2 : 0));
    }
    children.push(...notes(picker, inner, 3));
    entries.push({ kind: "folder", name, children });
  }
  entries.push(...notes(picker, rootNames, ROOT_NOTES));
  return entries;
}
