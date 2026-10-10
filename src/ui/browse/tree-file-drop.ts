import type { Action } from "svelte/action";
import { parentPath, type NotePath } from "../../changes/change";
import type { ImportDestination } from "../../import/plan-import";
import type { DroppedFile } from "../../import/read-dropped-files";

export interface TreeFileDropOptions {
  readonly onDrop: (
    files: readonly DroppedFile[],
    destination: ImportDestination,
  ) => void;
}

interface Resolved {
  readonly destination: ImportDestination;
  readonly highlight: HTMLElement | null;
}

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

function rowPath(row: HTMLElement): NotePath {
  return JSON.parse(row.dataset.treePath ?? "[]") as NotePath;
}

function folderRow(container: HTMLElement, path: NotePath): HTMLElement | null {
  const key = JSON.stringify(path);
  for (const row of container.querySelectorAll<HTMLElement>(
    '[data-tree-row][data-tree-kind="folder"]',
  )) {
    if (row.dataset.treePath === key) return row;
  }
  return null;
}

function resolve(container: HTMLElement, target: EventTarget | null): Resolved {
  const row =
    target instanceof Element
      ? target.closest<HTMLElement>("[data-tree-row]")
      : null;
  if (row === null || !container.contains(row)) {
    return { destination: { kind: "root" }, highlight: container };
  }
  const path = rowPath(row);
  if (row.dataset.treeKind === "folder") {
    return { destination: { kind: "folder", path }, highlight: row };
  }
  if (path.length <= 1) {
    return { destination: { kind: "root" }, highlight: container };
  }
  const parent = parentPath(path);
  return {
    destination: { kind: "folder", path: parent },
    highlight: folderRow(container, parent),
  };
}

function droppedFiles(transfer: DataTransfer): DroppedFile[] {
  const files: DroppedFile[] = [];
  for (const item of transfer.items) {
    if (item.kind !== "file") continue;
    const directory = item.webkitGetAsEntry?.()?.isDirectory ?? false;
    const file = item.getAsFile();
    if (file === null) continue;
    files.push({
      name: file.name,
      size: file.size,
      directory,
      arrayBuffer: () => file.arrayBuffer(),
    });
  }
  return files;
}

export const treeFileDrop: Action<HTMLElement, TreeFileDropOptions> = (
  container,
  initial,
) => {
  let options = initial;
  let highlighted: HTMLElement | null = null;

  function highlight(element: HTMLElement | null): void {
    if (element === highlighted) return;
    if (highlighted !== null) delete highlighted.dataset.dropInto;
    highlighted = element;
    if (element !== null) element.dataset.dropInto = "";
  }

  function onDragOver(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.type === "dragover" && event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = "copy";
    }
    highlight(resolve(container, event.target).highlight);
  }

  function onDragLeave(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const next = event.relatedTarget;
    if (next instanceof Node && container.contains(next)) return;
    highlight(null);
  }

  function onDrop(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    highlight(null);
    if (event.dataTransfer === null) return;
    const { destination } = resolve(container, event.target);
    options.onDrop(droppedFiles(event.dataTransfer), destination);
  }

  function onDragEnd(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    highlight(null);
  }

  container.addEventListener("dragenter", onDragOver);
  container.addEventListener("dragover", onDragOver);
  container.addEventListener("dragleave", onDragLeave);
  container.addEventListener("drop", onDrop);
  container.addEventListener("dragend", onDragEnd);

  return {
    update(next) {
      options = next;
    },
    destroy() {
      highlight(null);
      container.removeEventListener("dragenter", onDragOver);
      container.removeEventListener("dragover", onDragOver);
      container.removeEventListener("dragleave", onDragLeave);
      container.removeEventListener("drop", onDrop);
      container.removeEventListener("dragend", onDragEnd);
    },
  };
};
