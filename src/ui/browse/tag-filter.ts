import { COLOR_TAG_PALETTE, type ColorTag } from "../../tags/color-tag";
import type {
  WorkingFolder,
  WorkingNode,
  WorkingTree,
} from "../../sync/working-tree";

export interface TagFilterView {
  readonly tree: WorkingTree;
  readonly usedTags: readonly ColorTag[];
}

export function buildTagFilter(
  tree: WorkingTree,
  tag: ColorTag | null,
): TagFilterView {
  const used = new Set<ColorTag>();
  collectTags(tree.root, used);
  const usedTags = COLOR_TAG_PALETTE.map((entry) => entry.id).filter((id) =>
    used.has(id),
  );
  if (tag === null) return { tree, usedTags };
  const root: WorkingFolder = {
    ...tree.root,
    children: filterChildren(tree.root.children, tag),
  };
  return { tree: { ...tree, root }, usedTags };
}

function collectTags(folder: WorkingFolder, used: Set<ColorTag>): void {
  for (const child of folder.children) {
    if (child.kind === "folder") collectTags(child, used);
    else if (child.colorTag !== null) used.add(child.colorTag);
  }
}

function filterChildren(
  children: readonly WorkingNode[],
  tag: ColorTag,
): readonly WorkingNode[] {
  const kept: WorkingNode[] = [];
  for (const child of children) {
    if (child.kind === "note") {
      if (child.colorTag === tag) kept.push(child);
      continue;
    }
    const filtered = filterChildren(child.children, tag);
    if (filtered.length > 0) kept.push({ ...child, children: filtered });
  }
  return kept;
}
