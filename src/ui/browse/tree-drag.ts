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
  hitTestNoteArea,
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
  /** A touch long-press released without moving opens the row's menu. */
  readonly onMenu: (row: HTMLElement, x: number, y: number) => void;
  /**
   * Where a dragged note can be dropped to open it, or null; it has
   * `data-note-drop` while a note hovers over it.
   */
  readonly noteArea: () => HTMLElement | null;
  readonly onOpen: (path: NotePath) => void;
}

export interface DragSession {
  move(x: number, y: number): void;
  drop(): void;
  cancel(): void;
}

const MOUSE_DRAG_THRESHOLD = 4;
const LONG_PRESS_MS = 400;
const TOUCH_SLOP = 8;
const SCROLL_EDGE = 40;
const MAX_SCROLL_STEP = 14;
const DEFAULT_INDENT_STEP = 24;
const SLOT_INSET = 4;
const VANISH_INSET = 12;

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
  const area = options.noteArea();
  let hit: DropHit | { readonly kind: "open" } = { kind: "unchanged" };
  let overArea = false;
  let intoRow: HTMLElement | null = null;
  let frame = 0;
  let ended = false;

  function highlightArea(on: boolean): void {
    if (area === null) return;
    if (on) area.dataset.noteDrop = "";
    else delete area.dataset.noteDrop;
  }

  function render(): void {
    const areaHit = hitTestNoteArea(
      area?.getBoundingClientRect() ?? null,
      scene.draggedKind,
      pointerX,
      pointerY,
    );
    overArea = areaHit !== "outside";
    hit =
      areaHit === "outside"
        ? hitTestDrop(scene, pointerX, toContentY(pointerY))
        : { kind: areaHit === "open" ? "open" : "unchanged" };
    highlightArea(areaHit === "open");
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
    frame = requestAnimationFrame(scrollStep);
    if (overArea) return;
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
    highlightArea(false);
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
    highlightArea(false);
    await preview.settle(originRect(), { depth });
    finish();
  }

  async function open(): Promise<void> {
    container.dataset.dragState = "settling";
    highlightArea(false);
    const rect = area?.getBoundingClientRect();
    options.onOpen(dragged);
    if (rect !== undefined) {
      await preview.vanish(rect.left + VANISH_INSET, rect.top + VANISH_INSET);
    }
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
      end(() => {
        if (hit.kind === "drop") return land(hit.target);
        return hit.kind === "open" ? open() : settleBack();
      });
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
 * Drag-and-drop for the note tree. A mouse drag starts once a pressed row
 * moves past a small threshold, so a plain click still activates the row.
 * On touch, a long-press lifts the row: moving then drags it, releasing
 * without moving opens the row menu, and moving before the lift scrolls.
 */
export function treeDrag(
  container: HTMLElement,
  initial: TreeDragOptions,
): ActionReturn<TreeDragOptions> {
  let options = initial;
  let pending: {
    readonly pointerId: number;
    readonly touch: boolean;
    readonly startX: number;
    readonly startY: number;
    x: number;
    y: number;
    readonly row: HTMLElement;
    readonly timer: ReturnType<typeof setTimeout> | undefined;
  } | null = null;
  let session: {
    readonly pointerId: number;
    readonly drag: DragSession;
    readonly touch: {
      readonly row: HTMLElement;
      readonly x: number;
      readonly y: number;
      moved: boolean;
    } | null;
  } | null = null;
  let busy = false;
  let touchPressOnRow = false;
  let liftedByTouch = false;

  function clearPending(): void {
    if (pending?.timer !== undefined) clearTimeout(pending.timer);
    pending = null;
  }

  function begin(row: HTMLElement, x: number, y: number): DragSession | null {
    const drag = startDrag(container, row, x, y, options, () => {
      busy = false;
    });
    if (drag !== null) busy = true;
    return drag;
  }

  function liftByTouch(): void {
    if (pending === null) return;
    const { pointerId, row, x, y } = pending;
    pending = null;
    const drag = begin(row, x, y);
    if (drag === null) return;
    liftedByTouch = true;
    session = { pointerId, drag, touch: { row, x, y, moved: false } };
  }

  function onPointerDown(event: PointerEvent): void {
    touchPressOnRow = false;
    const touch = event.pointerType === "touch";
    if (!touch && (event.pointerType !== "mouse" || event.button !== 0)) return;
    if (busy || session !== null) return;
    if (touch && (!event.isPrimary || pending !== null)) {
      clearPending();
      return;
    }
    const handle = (event.target as Element).closest("[data-drag-handle]");
    const row = handle?.closest<HTMLElement>("[data-tree-row]");
    if (row == null || !container.contains(row)) return;
    if (touch) {
      touchPressOnRow = true;
      liftedByTouch = false;
    }
    pending = {
      pointerId: event.pointerId,
      touch,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      row,
      timer: touch ? setTimeout(liftByTouch, LONG_PRESS_MS) : undefined,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    if (session !== null) {
      if (event.pointerId !== session.pointerId) return;
      const { touch } = session;
      if (
        touch !== null &&
        Math.hypot(event.clientX - touch.x, event.clientY - touch.y) >
          TOUCH_SLOP
      ) {
        touch.moved = true;
      }
      session.drag.move(event.clientX, event.clientY);
      return;
    }
    if (pending === null || event.pointerId !== pending.pointerId) return;
    const distance = Math.hypot(
      event.clientX - pending.startX,
      event.clientY - pending.startY,
    );
    if (pending.touch) {
      if (distance > TOUCH_SLOP) clearPending();
      else {
        pending.x = event.clientX;
        pending.y = event.clientY;
      }
      return;
    }
    if (distance <= MOUSE_DRAG_THRESHOLD) return;
    const { row, startX, startY } = pending;
    pending = null;
    const drag = begin(row, startX, startY);
    if (drag === null) return;
    session = { pointerId: event.pointerId, drag, touch: null };
    container.setPointerCapture(event.pointerId);
    drag.move(event.clientX, event.clientY);
  }

  function onPointerUp(event: PointerEvent): void {
    clearPending();
    if (session === null || event.pointerId !== session.pointerId) return;
    const { drag, touch } = session;
    session = null;
    if (touch === null) {
      suppressNextClick();
      drag.drop();
    } else if (touch.moved) {
      drag.drop();
    } else {
      drag.cancel();
      options.onMenu(touch.row, touch.x, touch.y);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.type === "lostpointercapture" && event.target !== container) {
      return;
    }
    clearPending();
    if (session === null || event.pointerId !== session.pointerId) return;
    const { drag } = session;
    session = null;
    drag.cancel();
  }

  // Touch pointers stay implicitly captured by the pressed row, so page
  // scrolling is held back by cancelling the touch events themselves.
  function onTouchMove(event: TouchEvent): void {
    if (session?.touch != null && event.cancelable) event.preventDefault();
  }

  // Cancelling touchend keeps the browser from turning a lifted press into
  // a click that would open the note.
  function onTouchEnd(event: TouchEvent): void {
    if (!liftedByTouch) return;
    liftedByTouch = false;
    if (event.cancelable) event.preventDefault();
  }

  function onContextMenu(event: MouseEvent): void {
    const pointerType = (event as Partial<PointerEvent>).pointerType;
    if (!touchPressOnRow || pointerType === "mouse") return;
    event.preventDefault();
    event.stopPropagation();
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerCancel);
  container.addEventListener("lostpointercapture", onPointerCancel);
  container.addEventListener("touchmove", onTouchMove, { passive: false });
  container.addEventListener("touchend", onTouchEnd, { passive: false });
  container.addEventListener("contextmenu", onContextMenu, { capture: true });

  return {
    update(next) {
      options = next;
    },
    destroy() {
      clearPending();
      session?.drag.cancel();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerCancel);
      container.removeEventListener("lostpointercapture", onPointerCancel);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("contextmenu", onContextMenu, {
        capture: true,
      });
    },
  };
}
