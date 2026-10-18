<script lang="ts">
  import { prefersReducedMotion } from "../browse/drag-motion";
  import { dialogStack } from "../dialogs/dialog-stack";
  import { captureFocusReturn, returnFocus } from "../dialogs/focus-return";
  import { swipeToClose } from "../dialogs/swipe-to-close";

  interface Props {
    url: string;
    alt: string;
    width?: number;
    height?: number;
    origin: HTMLElement | null;
    onRemove?: () => void;
    onClose: () => void;
  }

  const { url, alt, width, height, origin, onRemove, onClose }: Props = $props();

  const OPEN_MS = 240;
  const FADE_MS = 160;
  const EASING = "cubic-bezier(0.2, 0, 0, 1)";

  let dialogEl: HTMLDialogElement | null = $state(null);
  let figureEl: HTMLElement | null = $state(null);
  let imgEl: HTMLImageElement | null = $state(null);
  let closeButtonEl: HTMLButtonElement | null = $state(null);
  let measured = $state<{ width: number; height: number } | null>(null);

  const naturalWidth = $derived(width ?? measured?.width);
  const naturalHeight = $derived(height ?? measured?.height);

  const returnTo = captureFocusReturn();
  let closing = false;
  let finished = false;

  function zoomTransform(from: DOMRect, to: DOMRect): string {
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const scale = to.width > 0 ? from.width / to.width : 1;
    return `translate(${dx}px, ${dy}px) scale(${scale})`;
  }

  function usableOrigin(): HTMLElement | null {
    if (origin === null || !origin.isConnected) return null;
    const rect = origin.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? origin : null;
  }

  async function animate(el: HTMLDialogElement, img: HTMLImageElement, reverse: boolean) {
    const source = usableOrigin();
    const duration = source === null ? FADE_MS : OPEN_MS;
    const animations: Animation[] = [];
    const backdrop: Keyframe[] = [{ backgroundColor: "transparent" }, {}];
    if (reverse) backdrop.reverse();
    animations.push(
      el.animate(backdrop, { duration, easing: EASING, fill: reverse ? "forwards" : "none" }),
    );
    if (source !== null) {
      const zoom = zoomTransform(source.getBoundingClientRect(), img.getBoundingClientRect());
      const frames: Keyframe[] = [{ transform: zoom }, { transform: "none" }];
      if (reverse) frames.reverse();
      animations.push(
        img.animate(frames, { duration, easing: EASING, fill: reverse ? "forwards" : "backwards" }),
      );
    } else {
      const frames: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
      if (reverse) frames.reverse();
      animations.push(
        img.animate(frames, { duration, easing: EASING, fill: reverse ? "forwards" : "backwards" }),
      );
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, duration + 100);
    });
    const done = Promise.all(animations.map((a) => a.finished)).then(
      () => undefined,
      () => undefined,
    );
    await Promise.race([done, timeout]);
    clearTimeout(timer);
  }

  async function playOpen(el: HTMLDialogElement, img: HTMLImageElement): Promise<void> {
    if (prefersReducedMotion()) return;
    if (!img.complete) {
      img.style.opacity = "0";
      await new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      });
      if (closing) return;
    }
    const pending = animate(el, img, false);
    img.style.removeProperty("opacity");
    await pending;
  }

  function endClose(el: HTMLDialogElement, restoreFocus: boolean): void {
    if (finished) return;
    finished = true;
    if (el.open) el.close();
    if (restoreFocus) returnFocus(origin ?? returnTo, el);
  }

  function beginClose(el: HTMLDialogElement): boolean {
    if (closing) return false;
    closing = true;
    el.inert = true;
    dialogStack.unregister(el);
    return true;
  }

  function close(): void {
    const el = dialogEl;
    const img = imgEl;
    if (el === null || !beginClose(el)) return;
    const swiped = el.dataset.swipe === "closed";
    if (swiped || img === null || prefersReducedMotion()) {
      endClose(el, true);
      onClose();
      return;
    }
    void animate(el, img, true).then(() => {
      endClose(el, true);
      onClose();
    });
  }

  function remove(): void {
    const el = dialogEl;
    if (el === null || !beginClose(el)) return;
    endClose(el, false);
    onRemove?.();
    onClose();
  }

  function handleCancel(event: Event): void {
    event.preventDefault();
    close();
  }

  function handleClick(event: MouseEvent): void {
    const target = event.target;
    if (target === dialogEl || target === figureEl || (target as Element).classList?.contains("lightbox-stage")) {
      close();
    }
  }

  function handleImageLoad(event: Event): void {
    const img = event.currentTarget as HTMLImageElement;
    if (img.naturalWidth > 0) {
      measured = { width: img.naturalWidth, height: img.naturalHeight };
    }
  }

  $effect(() => {
    const el = dialogEl;
    const img = imgEl;
    if (el === null || img === null) return;
    if (!el.open) {
      el.showModal();
      dialogStack.register(el);
    }
    closeButtonEl?.focus();
    void playOpen(el, img);
    return () => {
      dialogStack.unregister(el);
      if (el.open) el.close();
    };
  });
</script>

<dialog
  bind:this={dialogEl}
  class="image-lightbox"
  aria-label={alt || "Image"}
  oncancel={handleCancel}
  onclick={handleClick}
>
  <div
    class="lightbox-stage"
    use:swipeToClose={{ enabled: true, onClose: close, card: figureEl, narrowOnly: false }}
  >
    <figure bind:this={figureEl} class="lightbox-figure">
      <img
        bind:this={imgEl}
        src={url}
        {alt}
        style:--natural-width={naturalWidth === undefined ? undefined : `${naturalWidth}px`}
        style:--natural-height={naturalHeight === undefined ? undefined : `${naturalHeight}px`}
        onload={handleImageLoad}
      />
      {#if alt !== ""}
        <figcaption>{alt}</figcaption>
      {/if}
    </figure>
    {#if onRemove}
      <button type="button" class="button lightbox-remove" onclick={remove}>
        Remove from note
      </button>
    {/if}
  </div>
  <button
    bind:this={closeButtonEl}
    type="button"
    class="button button-icon button-ghost lightbox-close"
    aria-label="Close"
    onclick={close}
  >
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  </button>
</dialog>

<style>
  .image-lightbox {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
      env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
    border: 0;
    overflow: hidden;
    box-sizing: border-box;
    background: var(--color-lightbox-backdrop);
    color: var(--color-lightbox-text);
    color-scheme: dark;
    opacity: calc(1 - var(--swipe-progress, 0));
  }

  .image-lightbox::backdrop {
    background: transparent;
  }

  .image-lightbox[open] {
    display: flex;
    flex-direction: column;
  }

  .image-lightbox:global([data-swipe="dragging"]) .lightbox-figure {
    transition: none;
  }

  .image-lightbox:global([data-swipe="settling"]) {
    transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1);
  }

  .image-lightbox:global([data-swipe="settling"]) .lightbox-figure {
    transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
  }

  .lightbox-stage {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: calc(var(--touch-target) + var(--space-3)) var(--space-3) var(--space-3);
    touch-action: none;
    user-select: none;
  }

  .lightbox-figure {
    flex: 1 1 auto;
    min-height: 0;
    max-width: 100%;
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
  }

  .lightbox-figure img {
    flex: 0 1 auto;
    min-height: 0;
    max-width: min(100%, var(--natural-width, 100%));
    max-height: min(100%, var(--natural-height, 100%));
    object-fit: contain;
    -webkit-user-drag: none;
  }

  .lightbox-figure figcaption {
    flex: none;
    max-width: min(100%, 60ch);
    text-align: center;
    font-size: var(--font-size-sm);
    line-height: var(--line-height);
    overflow-wrap: anywhere;
  }

  .lightbox-remove {
    flex: none;
  }

  .lightbox-close {
    position: absolute;
    inset-block-start: calc(env(safe-area-inset-top, 0px) + var(--space-2));
    inset-inline-end: calc(env(safe-area-inset-right, 0px) + var(--space-2));
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    color: inherit;
  }
</style>
