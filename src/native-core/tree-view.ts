import { countFolderNotes } from "../ui/browse/folder-note-count";
import type { WorkingNode, WorkingTree } from "../sync/working-tree";
import type { TreeNode } from "./api";

function toNode(node: WorkingNode): TreeNode {
  if (node.kind === "note") {
    return {
      kind: "note",
      name: node.name,
      path: [...node.path],
      colorTag: node.colorTag,
      shared: node.shared,
    };
  }
  return {
    kind: "folder",
    name: node.name,
    path: [...node.path],
    noteCount: countFolderNotes(node),
    children: node.children.map(toNode),
  };
}

export function toTreeNodes(tree: WorkingTree | null): TreeNode[] | null {
  return tree === null ? null : tree.root.children.map(toNode);
}
