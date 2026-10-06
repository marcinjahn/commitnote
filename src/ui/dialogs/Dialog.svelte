<script lang="ts">
  import type { Snippet } from "svelte";
  import { swipeToClose } from "./swipe-to-close";

  interface Props {
    open: boolean;
    title: string;
    onClose: () => void;
    children: Snippet;
    actions?: Snippet;
    headerStatus?: Snippet;
    large?: boolean;
    /** Full screen on mobile; a wide, fixed-height card on desktop whose content scrolls itself. */
    wide?: boolean;
    /** Large width on desktop only; mobile keeps the bottom sheet. Ignored with `large` or `wide`. */
    desktopLarge?: boolean;
    closeButton?: boolean;
    accentBorder?: boolean;
    swipeToClose?: boolean;
  }

  const {
    open,
    title,
    onClose,
    children,
    actions,
    headerStatus,
    large: largeProp = false,
    wide = false,
    desktopLarge: desktopLargeProp = false,
    closeButton = false,
    accentBorder = false,
    swipeToClose: swipeEnabled = true,
  }: Props = $props();

  const large = $derived(largeProp || wide);
  const desktopLarge = $derived(desktopLargeProp && !large);
  const uid = $props.id();
  const titleId = `dialog-title-${uid}`;

  let dialogEl: HTMLDialogElement | undefined = $state();

  function focusInitialElement(el: HTMLDialogElement): void {
    const field = el.querySelector<HTMLElement>(
      "input:not(:disabled), textarea:not(:disabled), select:not(:disabled)",
    );
    let target: HTMLElement | null = field;
    if (field instanceof HTMLInputElement && field.type === "radio" && field.name !== "") {
      const checked = Array.from(
        el.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked:not(:disabled)'),
      ).find((radio) => radio.name === field.name);
      target = checked ?? field;
    }
    target ??= el.querySelector<HTMLElement>("button:not(:disabled)");
    target?.focus();
    if (
      target instanceof HTMLInputElement && target.type !== "radio" ||
      target instanceof HTMLTextAreaElement
    ) {
      target.select();
    }
  }

  $effect(() => {
    const el = dialogEl;
    if (el === undefined) return;
    if (open) {
      if (!el.open) {
        el.showModal();
      }
      focusInitialElement(el);
    } else if (el.open) {
      el.close();
    }
  });

  function handleCancel(event: Event): void {
    event.preventDefault();
    onClose();
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialogEl) {
      onClose();
    }
  }
</script>

<dialog
  bind:this={dialogEl}
  class="dialog"
  class:large
  class:wide
  class:desktop-large={desktopLarge}
  aria-labelledby={titleId}
  oncancel={handleCancel}
  onclick={handleBackdropClick}
>
  <div
    class="dialog-card"
    class:large
    class:wide
    class:desktop-large={desktopLarge}
    class:accent-border={accentBorder}>
    <div
      class="dialog-header"
      class:swipeable={swipeEnabled}
      use:swipeToClose={{ enabled: swipeEnabled, onClose }}
    >
      {#if swipeEnabled}
        <div class="dialog-grab-handle" data-testid="dialog-grab-handle" aria-hidden="true"></div>
      {/if}
      <h2 id={titleId} class="dialog-title">{title}</h2>
      {#if headerStatus}
        <div class="dialog-header-status">
          {@render headerStatus()}
        </div>
      {/if}
      {#if closeButton}
        <button
          type="button"
          class="button button-icon button-ghost dialog-close"
          aria-label="Close"
          onclick={onClose}
        >
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      {/if}
    </div>
    <div class="dialog-body" class:wide>
      {@render children()}
    </div>
    {#if actions}
      <div class="dialog-actions">
        {@render actions()}
      </div>
    {/if}
  </div>
</dialog>

<style>
  .dialog {
    position: fixed;
    inset: auto 0 0 0;
    margin: 0;
    width: 100%;
    max-width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    /* the card scrolls its own body; a scrolling <dialog> would flash a
       scrollbar while the opening translateY pushes the card past its box */
    overflow: visible;
  }

  .dialog::backdrop {
    background: var(--color-backdrop);
    opacity: calc(1 - var(--swipe-progress, 0));
    transition: opacity var(--motion-duration) var(--motion-easing);
  }

  .dialog:global([data-swipe="dragging"])::backdrop,
  .dialog:global([data-swipe="dragging"]) .dialog-card {
    transition: none;
  }

  .dialog:global([data-swipe="settling"])::backdrop {
    transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1);
  }

  .dialog:global([data-swipe="settling"]) .dialog-card {
    transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
  }

  @starting-style {
    .dialog[open]::backdrop {
      opacity: 0;
    }
  }

  .dialog-card {
    --dialog-card-padding-top: var(--space-5);
    --dialog-card-padding-inline: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-height: 90dvh;
    overflow: hidden;
    background: var(--color-surface-raised);
    color: var(--color-text);
    box-shadow: var(--shadow-3);
    border: var(--hairline) solid light-dark(var(--color-border), var(--color-border-strong));
    border-bottom: none;
    border-radius: var(--radius) var(--radius) 0 0;
    padding: var(--dialog-card-padding-top) var(--dialog-card-padding-inline);
    padding-bottom: calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
    transition:
      opacity var(--motion-duration) var(--motion-easing),
      transform var(--motion-duration) var(--motion-easing);
  }

  @starting-style {
    .dialog[open] .dialog-card {
      opacity: 0;
      transform: translateY(var(--space-2));
    }
  }

  .dialog-card.accent-border {
    border-color: var(--color-accent);
  }

  .dialog-header {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .dialog-header.swipeable {
    margin-block-start: calc(-1 * var(--dialog-card-padding-top));
    margin-inline: calc(-1 * var(--dialog-card-padding-inline));
    padding-block-start: var(--dialog-card-padding-top);
    padding-inline: var(--dialog-card-padding-inline);
    touch-action: none;
  }

  .dialog-grab-handle {
    position: absolute;
    top: calc(var(--dialog-card-padding-top) - var(--space-4));
    left: 50%;
    width: 36px;
    height: 4px;
    transform: translateX(-50%);
    background: var(--color-border-strong);
  }

  .dialog-header-status {
    display: flex;
    align-items: center;
    min-width: 0;
    margin-inline-start: auto;
  }

  .dialog-close {
    flex-shrink: 0;
    margin-block: calc(-1 * var(--space-2));
    margin-inline-end: calc(-1 * var(--space-2));
  }

  .dialog-title {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-tight);
  }

  .dialog-body {
    font-size: var(--font-size-base);
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    /* room for the 2px focus outline + 2px offset that overflow would clip */
    padding: var(--space-1);
    margin: calc(-1 * var(--space-1));
  }

  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .dialog.large {
    height: 100dvh;
    max-height: none;
  }

  .dialog-card.large {
    height: 100dvh;
    max-height: 100dvh;
    border: none;
    border-radius: 0;
    --dialog-card-padding-top: calc(var(--space-5) + env(safe-area-inset-top, 0px));
  }

  .dialog-card.wide {
    --dialog-card-padding-top: calc(var(--space-3) + env(safe-area-inset-top, 0px));
    --dialog-card-padding-inline: 0px;
    gap: var(--space-2);
    padding-bottom: 0;
  }

  .dialog-card.wide .dialog-header {
    padding-inline: var(--space-3) var(--space-2);
  }

  .dialog-card.wide .dialog-grab-handle {
    top: calc(var(--dialog-card-padding-top) - 10px);
  }

  .dialog-card.wide .dialog-actions {
    padding: var(--space-2) var(--space-3)
      calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
    border-top: var(--hairline) solid var(--color-border);
  }

  .dialog-body.wide {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0;
    margin: 0;
  }

  @media (min-width: 768px) {
    .dialog {
      position: fixed;
      inset: 0;
      margin: auto;
      width: auto;
      max-width: var(--dialog-width);
    }

    .dialog-card {
      max-height: 80dvh;
      border-bottom: var(--hairline) solid var(--color-border);
      border-radius: var(--radius);
      padding-bottom: var(--space-5);
    }

    .dialog-header.swipeable {
      margin: 0;
      padding-block-start: 0;
      padding-inline: 0;
      touch-action: auto;
    }

    .dialog-grab-handle {
      display: none;
    }

    .dialog-card.accent-border {
      border-bottom-color: var(--color-accent);
    }

    .dialog.desktop-large {
      max-width: var(--dialog-width-large);
    }

    .dialog-card.desktop-large {
      --dialog-card-padding-inline: var(--space-5);
    }

    .dialog.large {
      height: fit-content;
      max-width: var(--dialog-width-large);
    }

    .dialog-card.large {
      height: auto;
      max-height: 80dvh;
      border: var(--hairline) solid light-dark(var(--color-border), var(--color-border-strong));
      border-radius: var(--radius);
      padding-top: var(--space-5);
    }

    .dialog.wide {
      width: calc(100vw - var(--space-5) * 2);
      max-width: var(--dialog-width-wide);
    }

    .dialog-card.wide {
      gap: var(--space-4);
      height: 80dvh;
      padding: var(--space-5) var(--space-4);
    }

    .dialog-card.wide .dialog-header {
      padding-inline: 0;
    }

    .dialog-card.wide .dialog-actions {
      padding: 0;
      border-top: none;
    }
  }
</style>
