import { tick } from "svelte";
import type { ActionReturn } from "svelte/action";
import type { NotePath } from "../../changes/change";
import { isWithinFolder, notePathEquals } from "../../changes/change";
import {
  liftPreview,
  measureTops,
  playFlip,
  type DragPreview,
} from "./drag-motion";
import {
  hitTestDrop,
  type DropHit,
  type DropRow,
  type DropScene,
  type DropTarget,
} from "./tree-drop";

/**
 * Rows are `[data-tree-row]` elements carrying `data-tree-path` (the JSON
 * path) and `data-tree-kind`; a drag starts on their `[data-drag-handle]`.
 * While a drag or its settling runs, the container has `data-drag-state`.
 */
export interface TreeDragOptions {
  readonly scene: (
    dragged: NotePath,
  ) => Pick<DropScene, "draggedKind" | "conflicted" | "childrenOf"> | null;
  /** Applies the drop; returns the item's new path, or null if refused. */
  readonly onDrop: (path: NotePath, target: DropTarget) => NotePath | null;
}

export interface DragSession {
  move(x: number, y: number): void;
  drop(): void;
  cancel(): void;
}

const MOUSE_DRAG_THRESHOLD = 4;
const SCROLL_EDGE = 40;
const MAX_SCROLL_STEP = 14;
const DEFAULT_INDENT_STEP = 24;
const SLOT_INSET = 4;

function pathOf(row: HTMLElement): NotePath {
  return JSON.parse(row.dataset.treePath ?? "[]") as NotePath;
}

function rowElements(container: HTMLElement): Map<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>();
  for (const row of container.querySelectorAll<HTMLElement>(
    "[data-tree-row]",
  )) {
    rows.set(row.dataset.treePath ?? "", row);
  }
  return rows;
}

function isAtOrWithin(path: NotePath, folder: NotePath): boolean {
  return notePathEquals(path, folder) || isWithinFolder(path, folder);
}

/**
 * Lifts `row` and drags it until the returned session is dropped or
 * cancelled; `onEnd` runs once everything has settled. Input-agnostic, so
 * any way of starting a drag (mouse threshold, touch long-press) can use it.
 */
export function startDrag(
  container: HTMLElement,
  row: HTMLElement,
  x: number,
  y: number,
  options: TreeDragOptions,
  onEnd: () => void,
): DragSession | null {
  const dragged = pathOf(row);
  const base = options.scene(dragged);
  if (base === null) return null;

  const elements = [...rowElements(container).values()];
  const containerRect = container.getBoundingClientRect();
  const toContentY = (clientY: number) =>
    clientY - container.getBoundingClientRect().top + container.scrollTop;
  const rows: DropRow[] = elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      path: pathOf(element),
      kind: element.dataset.treeKind === "folder" ? "folder" : "note",
      top: rect.top - containerRect.top + container.scrollTop,
      height: rect.height,
    };
  });
  const sourceIndex = elements.indexOf(row);
  const source = rows[sourceIndex];

  const handle = row.querySelector<HTMLElement>("[data-drag-handle]");
  const indentStep =
    parseFloat(getComputedStyle(container).getPropertyValue("--space-4")) ||
    DEFAULT_INDENT_STEP;
  const depth = dragged.length - 1;
  const handleIndent =
    handle === null ? 0 : parseFloat(getComputedStyle(handle).paddingLeft) || 0;
  const indentStart =
    (handle?.getBoundingClientRect().left ?? containerRect.left) +
    handleIndent -
    depth * indentStep;
  const scene: DropScene = {
    ...base,
    rows,
    dragged,
    indentStart,
    indentStep,
  };

  container.dataset.dragState = "dragging";
  window.getSelection()?.removeAllRanges();
  elements.forEach((element, i) => {
    if (isAtOrWithin(rows[i].path, dragged)) element.dataset.dragSource = "";
  });
  const preview: DragPreview = liftPreview(row, x, y);

  const slot = document.createElement("div");
  slot.className = "tree-drop-slot";
  slot.hidden = true;
  slot.style.height = `${source.height}px`;
  container.append(slot);

  let pointerX = x;
  let pointerY = y;
  let hit: DropHit = { kind: "unchanged" };
  let intoRow: HTMLElement | null = null;
  let frame = 0;
  let ended = false;

  function render(): void {
    hit = hitTestDrop(scene, pointerX, toContentY(pointerY));
    const gapIndex = hit.kind === "drop" ? hit.gapIndex : -1;
    elements.forEach((element, i) => {
      element.style.transform =
        gapIndex !== -1 && i >= gapIndex
          ? `translateY(${source.height}px)`
          : "";
    });

    let into: HTMLElement | null = null;
    if (hit.kind === "drop" && hit.into) {
      const parent = hit.target.parent;
      into = elements[rows.findIndex((r) => notePathEquals(r.path, parent))] ?? null;
    }
    if (into !== intoRow) {
      if (intoRow !== null) delete intoRow.dataset.dropInto;
      if (into !== null) into.dataset.dropInto = "";
      intoRow = into;
    }

    if (hit.kind === "drop" && gapIndex !== -1) {
      const last = rows[rows.length - 1];
      const top =
        rows[gapIndex]?.top ??
        (last === undefined ? 0 : last.top + last.height);
      const left =
        indentStart - containerRect.left + hit.depth * indentStep - SLOT_INSET;
      const wasHidden = slot.hidden;
      if (wasHidden) slot.style.transition = "none";
      slot.style.left = `${Math.max(0, left)}px`;
      slot.style.translate = `0 ${top}px`;
      slot.hidden = false;
      if (wasHidden) {
        slot.getBoundingClientRect();
        slot.style.transition = "";
      }
    } else {
      slot.hidden = true;
    }
    preview.setRefused(hit.kind === "refused");
  }

  function scrollStep(): void {
    const rect = container.getBoundingClientRect();
    let step = 0;
    if (pointerY < rect.top + SCROLL_EDGE) {
      step = -Math.min(1, (rect.top + SCROLL_EDGE - pointerY) / SCROLL_EDGE);
    } else if (pointerY > rect.bottom - SCROLL_EDGE) {
      step = Math.min(1, (pointerY - rect.bottom + SCROLL_EDGE) / SCROLL_EDGE);
    }
    if (step !== 0) {
      const before = container.scrollTop;
      container.scrollTop +=
        Math.ceil(Math.abs(step) * MAX_SCROLL_STEP) * Math.sign(step);
      if (container.scrollTop !== before) render();
    }
    frame = requestAnimationFrame(scrollStep);
  }
  frame = requestAnimationFrame(scrollStep);

  function finish(): void {
    preview.remove();
    slot.remove();
    for (const element of rowElements(container).values()) {
      element.style.transform = "";
      element.style.transition = "";
      element.style.opacity = "";
      delete element.dataset.dragSource;
      delete element.dataset.dropInto;
    }
    delete container.dataset.dragState;
    onEnd();
  }

  function originRect(): DOMRect {
    const rect = container.getBoundingClientRect();
    return new DOMRect(
      row.getBoundingClientRect().left,
      rect.top + source.top - container.scrollTop,
      row.getBoundingClientRect().width,
      source.height,
    );
  }

  async function settleBack(): Promise<void> {
    container.dataset.dragState = "settling";
    for (const element of elements) element.style.transform = "";
    slot.hidden = true;
    if (intoRow !== null) delete intoRow.dataset.dropInto;
    await preview.settle(originRect(), { depth });
    finish();
  }

  async function land(target: DropTarget): Promise<void> {
    const before = rowElements(container);
    for (const key of before.keys()) {
      if (isAtOrWithin(JSON.parse(key) as NotePath, dragged))
        before.delete(key);
    }
    const first = measureTops(before);
    const placed = options.onDrop(dragged, target);
    if (placed === null) {
      await settleBack();
      return;
    }
    container.dataset.dragState = "settling";
    slot.hidden = true;
    if (intoRow !== null) delete intoRow.dataset.dropInto;
    await tick();

    const after = rowElements(container);
    const landed: HTMLElement[] = [];
    for (const [key, element] of after) {
      delete element.dataset.dragSource;
      if (isAtOrWithin(JSON.parse(key) as NotePath, placed)) {
        landed.push(element);
        after.delete(key);
      }
    }
    playFlip(after, first);
    for (const element of landed) {
      element.style.transition = "none";
      element.style.transform = "";
      element.style.opacity = "0";
    }

    const landedRow = after.get(JSON.stringify(placed)) ?? landed[0];
    const parentRow = after.get(JSON.stringify(target.parent));
    if (landedRow !== undefined) {
      await preview.settle(landedRow.getBoundingClientRect(), {
        depth: placed.length - 1,
      });
    } else if (parentRow !== undefined) {
      await preview.settle(parentRow.getBoundingClientRect(), { fade: true });
    }
    finish();
  }

  function end(run: () => Promise<void>): void {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frame);
    void run();
  }

  render();
  return {
    move(nextX, nextY) {
      if (ended) return;
      pointerX = nextX;
      pointerY = nextY;
      preview.follow(nextX, nextY);
      render();
    },
    drop() {
      end(() => (hit.kind === "drop" ? land(hit.target) : settleBack()));
    },
    cancel() {
      end(settleBack);
    },
  };
}

// Swallows the click that the browser sends after a drag's pointerup.
function suppressNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, true), 0);
}

/**
 * Drag-and-drop for the note tree. Only mouse input for now: pressing a
 * row and moving it past a small threshold starts a drag, so a plain click
 * still activates the row.
 */
export function treeDrag(
  container: HTMLElement,
  initial: TreeDragOptions,
): ActionReturn<TreeDragOptions> {
  let options = initial;
  let pending: {
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
    readonly row: HTMLElement;
  } | null = null;
  let session: {
    readonly pointerId: number;
    readonly drag: DragSession;
  } | null = null;
  let busy = false;

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== "mouse" || event.button !== 0 || busy) return;
    const handle = (event.target as Element).closest("[data-drag-handle]");
    const row = handle?.closest<HTMLElement>("[data-tree-row]");
    if (row == null || !container.contains(row)) return;
    pending = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      row,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    if (session !== null) {
      if (event.pointerId === session.pointerId) {
        session.drag.move(event.clientX, event.clientY);
      }
      return;
    }
    if (pending === null || event.pointerId !== pending.pointerId) return;
    const distance = Math.hypot(
      event.clientX - pending.x,
      event.clientY - pending.y,
    );
    if (distance <= MOUSE_DRAG_THRESHOLD) return;
    const { row, x, y } = pending;
    pending = null;
    const drag = startDrag(container, row, x, y, options, () => {
      busy = false;
    });
    if (drag === null) return;
    busy = true;
    session = { pointerId: event.pointerId, drag };
    container.setPointerCapture(event.pointerId);
    drag.move(event.clientX, event.clientY);
  }

  function onPointerUp(event: PointerEvent): void {
    pending = null;
    if (session === null || event.pointerId !== session.pointerId) return;
    const { drag } = session;
    session = null;
    suppressNextClick();
    drag.drop();
  }

  function onPointerCancel(event: PointerEvent): void {
    pending = null;
    if (session === null || event.pointerId !== session.pointerId) return;
    const { drag } = session;
    session = null;
    drag.cancel();
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerCancel);
  container.addEventListener("lostpointercapture", onPointerCancel);

  return {
    update(next) {
      options = next;
    },
    destroy() {
      session?.drag.cancel();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerCancel);
      container.removeEventListener("lostpointercapture", onPointerCancel);
    },
  };
}

