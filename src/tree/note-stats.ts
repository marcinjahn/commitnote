import { markdownParser } from "../markdown/markdown-parser";
import { stripImageReferences } from "../images/image-reference";

const segmenters = new Map<string | undefined, Intl.Segmenter>();

export function countWords(text: string, locale?: string): number {
  let segmenter = segmenters.get(locale);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(locale, { granularity: "word" });
    segmenters.set(locale, segmenter);
  }
  let count = 0;
  for (const segment of segmenter.segment(stripImageReferences(text, "remove"))) {
    if (segment.isWordLike) count++;
  }
  return count;
}

export interface TaskProgress {
  readonly done: number;
  readonly total: number;
}

export function countTasks(text: string): TaskProgress {
  let done = 0;
  let total = 0;
  markdownParser.parse(text).iterate({
    enter(node) {
      if (node.name !== "TaskMarker") return;
      total++;
      const state = text[node.from + 1];
      if (state === "x" || state === "X") done++;
    },
  });
  return { done, total };
}
