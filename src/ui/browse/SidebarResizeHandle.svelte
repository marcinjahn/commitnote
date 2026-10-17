<script lang="ts">
  import { onDestroy } from "svelte";
  import { SIDEBAR_WIDTH_STEP } from "./sidebar-width";

  interface Props {
    width: number;
    min: number;
    max: number;
    controls: string;
    onResize: (width: number) => void;
    onCommit: (width: number) => void;
    onReset: () => void;
    onMeasure: () => void;
  }

  const {
    width,
    min,
    max,
    controls,
    onResize,
    onCommit,
    onReset,
    onMeasure,
  }: Props = $props();

  const RESIZING_CLASS = "sidebar-resizing";

  let drag: {
    readonly pointerId: number;
    readonly startX: number;
    readonly startWidth: number;
    lastWidth: number;
  } | null = $state(null);

  function clamp(value: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function step(next: number): void {
    const target = clamp(next);
    onResize(target);
    onCommit(target);
  }

  function onkeydown(event: KeyboardEvent): void {
    onMeasure();
    switch (event.key) {
      case "ArrowLeft":
        step(width - SIDEBAR_WIDTH_STEP);
        break;
      case "ArrowRight":
        step(width + SIDEBAR_WIDTH_STEP);
        break;
      case "Home":
        step(min);
        break;
      case "End":
        step(max);
        break;
      case "Enter":
        onReset();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function onpointerdown(event: PointerEvent): void {
    if (event.button !== 0 || drag !== null) return;
    onMeasure();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      lastWidth: width,
    };
    document.documentElement.classList.add(RESIZING_CLASS);
    event.preventDefault();
  }

  function onpointermove(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    drag.lastWidth = clamp(drag.startWidth + (event.clientX - drag.startX));
    onResize(drag.lastWidth);
  }

  function endDrag(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const finished = drag;
    drag = null;
    document.documentElement.classList.remove(RESIZING_CLASS);
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(finished.pointerId)) {
      handle.releasePointerCapture(finished.pointerId);
    }
    onCommit(finished.lastWidth);
  }

  onDestroy(() => {
    document.documentElement.classList.remove(RESIZING_CLASS);
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="sidebar-resize-handle"
  class:dragging={drag !== null}
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize sidebar"
  aria-valuenow={width}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-controls={controls}
  tabindex="0"
  {onkeydown}
  onfocus={onMeasure}
  onpointerenter={onMeasure}
  {onpointerdown}
  {onpointermove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onlostpointercapture={endDrag}
  ondblclick={onReset}
></div>

<style>
  .sidebar-resize-handle {
    position: absolute;
    inset-block: 0;
    inset-inline-end: -17px;
    width: 24px;
    margin: 0;
    z-index: 1;
    cursor: col-resize;
    background: transparent;
    touch-action: none;
    outline: none;
  }

  .sidebar-resize-handle:focus-visible {
    outline: none;
  }

  .sidebar-resize-handle::after {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-end: 17px;
    width: 2px;
    background: transparent;
  }

  .sidebar-resize-handle:hover::after,
  .sidebar-resize-handle.dragging::after,
  .sidebar-resize-handle:focus-visible::after {
    background: var(--color-accent);
  }

  @media (forced-colors: active) {
    .sidebar-resize-handle:hover::after,
    .sidebar-resize-handle.dragging::after,
    .sidebar-resize-handle:focus-visible::after {
      forced-color-adjust: none;
      background: Highlight;
    }
  }

  :global(html.sidebar-resizing),
  :global(html.sidebar-resizing *) {
    cursor: col-resize !important;
    user-select: none !important;
  }

  @media (display-mode: window-controls-overlay) {
    .sidebar-resize-handle {
      -webkit-app-region: no-drag;
      app-region: no-drag;
    }
  }

  @media (max-width: 767.98px) {
    .sidebar-resize-handle {
      display: none;
    }
  }
</style>
