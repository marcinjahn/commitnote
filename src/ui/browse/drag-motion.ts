export const DRAG_MOTION_MS = 200;
export const DRAG_EASING = "cubic-bezier(0.2, 0, 0, 1)";
const PILL_INSET = 12;

export const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isNarrowLayout(): boolean {
  return !window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

export interface DragPreview {
  follow(x: number, y: number): void;
  setRefused(refused: boolean): void;
  /**
   * Morphs back into a row at `rect` (indented to `depth` when given), or
   * shrinks away onto it with `fade`. Resolves once it has arrived.
   */
  settle(
    rect: DOMRect,
    options: { readonly depth?: number; readonly fade?: boolean },
  ): Promise<void>;
  /** Glides the pill's corner to (x, y) while it shrinks and fades out. */
  vanish(x: number, y: number): Promise<void>;
  remove(): void;
}

/**
 * Lifts a copy of `row` off the page under the pointer: the full-width row
 * shrinks into a raised pill around its content, keeping the grab point
 * inside it. `[data-drag-handle]` inside the row holds the indent
 * (`--depth`) and `[data-drag-label]` the name; `[data-drag-omit]` parts are
 * left out of the copy.
 */
export function liftPreview(
  row: HTMLElement,
  pointerX: number,
  pointerY: number,
): DragPreview {
  const rect = row.getBoundingClientRect();
  const grabX = pointerX - rect.left;
  const grabY = pointerY - rect.top;

  const copy = row.cloneNode(true) as HTMLElement;
  for (const omitted of copy.querySelectorAll("[data-drag-omit]")) {
    omitted.remove();
  }
  for (const element of [copy, ...copy.querySelectorAll("*")]) {
    element.removeAttribute("id");
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-tree")) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  copy.style.background = "transparent";
  copy.style.boxShadow = "none";
  copy.style.width = "100%";
  copy.style.height = "100%";

  const preview = document.createElement("div");
  preview.className = "tree-drag-preview";
  preview.setAttribute("aria-hidden", "true");
  preview.inert = true;
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;
  preview.style.translate = `${rect.left}px ${rect.top}px`;
  preview.append(copy);
  document.body.append(preview);

  const handle = copy.querySelector<HTMLElement>("[data-drag-handle]");
  const width = Math.min(rect.width, pillWidth(handle) ?? rect.width);
  const grabInPill = Math.min(
    Math.max(grabX, PILL_INSET),
    Math.max(PILL_INSET, width - PILL_INSET),
  );

  preview.getBoundingClientRect();
  preview.classList.add("lifted");
  preview.style.width = `${width}px`;
  preview.style.marginLeft = `${grabX - grabInPill}px`;

  return {
    follow(x, y) {
      preview.style.translate = `${x - grabX}px ${y - grabY}px`;
    },
    setRefused(refused) {
      preview.classList.toggle("refused", refused);
    },
    settle(target, options) {
      preview.classList.remove("lifted", "refused");
      preview.classList.add("settling");
      if (options.fade === true) preview.classList.add("fading");
      if (options.depth !== undefined) {
        handle?.style.setProperty("--depth", String(options.depth));
      }
      preview.style.translate = `${target.left}px ${target.top}px`;
      preview.style.width = `${target.width}px`;
      preview.style.marginLeft = "0px";
      return whenMoved(preview);
    },
    vanish(x, y) {
      preview.classList.remove("refused");
      preview.classList.add("settling", "fading");
      preview.style.translate = `${x}px ${y}px`;
      preview.style.marginLeft = "0px";
      return whenMoved(preview);
    },
    remove() {
      preview.remove();
    },
  };
}

// The handle's indent is replaced by the pill's own inset, so the pill
// fits the icons and the full name.
function pillWidth(handle: HTMLElement | null): number | null {
  const label = handle?.querySelector<HTMLElement>("[data-drag-label]");
  if (handle == null || label == null) return null;
  const handleRect = handle.getBoundingClientRect();
  const indent = parseFloat(getComputedStyle(handle).paddingLeft) || 0;
  const leading = label.getBoundingClientRect().left - handleRect.left - indent;
  return PILL_INSET + leading + label.scrollWidth + PILL_INSET;
}

function whenMoved(element: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      element.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
      resolve();
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === "translate") {
        done();
      }
    };
    element.addEventListener("transitionend", onEnd);
    const timer = setTimeout(done, DRAG_MOTION_MS + 100);
  });
}

/** Visual top of each element, transforms included, for `playFlip`. */
export function measureTops(
  elements: ReadonlyMap<string, HTMLElement>,
): Map<string, number> {
  const tops = new Map<string, number>();
  for (const [key, element] of elements) {
    tops.set(key, element.getBoundingClientRect().top);
  }
  return tops;
}

/**
 * Slides each element that was at `first` from there into its current
 * place, so a re-sorted list moves instead of jumping.
 */
export function playFlip(
  elements: ReadonlyMap<string, HTMLElement>,
  first: ReadonlyMap<string, number>,
): void {
  const moving: [HTMLElement, number][] = [];
  for (const [key, element] of elements) {
    element.style.transition = "none";
    element.style.transform = "";
    const top = first.get(key);
    if (top !== undefined) moving.push([element, top]);
  }
  if (prefersReducedMotion()) return;
  const offsets = moving.map(
    ([element, top]) => top - element.getBoundingClientRect().top,
  );
  moving.forEach(([element], i) => {
    if (Math.abs(offsets[i]) < 0.5) return;
    element.style.transform = `translateY(${offsets[i]}px)`;
  });
  document.body.getBoundingClientRect();
  for (const [element] of moving) {
    element.style.transition = `transform ${DRAG_MOTION_MS}ms ${DRAG_EASING}`;
    element.style.transform = "";
  }
}
