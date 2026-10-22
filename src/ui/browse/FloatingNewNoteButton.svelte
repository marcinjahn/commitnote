<script lang="ts">
  import type { FloatingNewNoteState } from "./floating-new-note";

  let {
    state,
    aboveFooter,
    onNewNote,
  }: {
    state: FloatingNewNoteState;
    aboveFooter: boolean;
    onNewNote: () => void;
  } = $props();
</script>

<button
  type="button"
  class="floating-new-note"
  class:compact={state === "compact"}
  class:hidden={state === "hidden"}
  class:above-footer={aboveFooter}
  data-floating-new-note
  aria-label="New note"
  inert={state === "hidden"}
  onclick={onNewNote}
>
  <svg class="plus" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
    ><path d="M12 4v16M4 12h16" /></svg
  >
  <span class="label" aria-hidden="true">New note</span>
</button>

<style>
  .floating-new-note {
    --floating-base-bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
    position: fixed;
    z-index: 15;
    right: calc(var(--space-4) + env(safe-area-inset-right, 0px));
    bottom: max(
      var(--floating-base-bottom),
      min(
        calc(var(--toast-stack-height, 0px) + var(--space-2)),
        calc(
          100dvh - 56px - var(--space-2) - var(--touch-target) - 2 * var(--space-2) - var(--hairline) -
            env(safe-area-inset-top, 0px)
        )
      )
    );
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 56px;
    padding: 0 var(--space-4);
    border: 0;
    border-radius: var(--radius);
    background: var(--color-ink);
    color: var(--color-on-ink);
    font: inherit;
    font-weight: var(--font-weight-medium);
    box-shadow:
      inset 0 -2px 0 var(--color-accent),
      var(--shadow-2);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    opacity: 1;
    transform: none;
    visibility: visible;
    transition:
      opacity var(--sheet-enter-duration) var(--sheet-enter-easing),
      transform var(--sheet-enter-duration) var(--sheet-enter-easing),
      bottom var(--motion-duration) var(--motion-easing),
      padding var(--motion-duration) var(--motion-easing),
      gap var(--motion-duration) var(--motion-easing),
      visibility 0s;
    transition-behavior: allow-discrete;
  }

  .above-footer {
    --floating-base-bottom: calc(
      var(--space-4) + var(--touch-target) + 2 * var(--space-2) + var(--hairline) +
        env(safe-area-inset-bottom, 0px)
    );
  }

  .plus {
    width: 24px;
    height: 24px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: square;
  }

  .label {
    white-space: nowrap;
    overflow: hidden;
    max-width: 8em;
    opacity: 1;
    transition:
      max-width var(--motion-duration) var(--motion-easing),
      opacity var(--motion-duration) var(--motion-easing);
  }

  .compact {
    padding: 0 16px;
    gap: 0;
  }

  .compact .label {
    max-width: 0;
    opacity: 0;
  }

  .floating-new-note:active {
    background: var(--color-ink-hover);
  }

  @media (hover: hover) {
    .floating-new-note:hover {
      background: var(--color-ink-hover);
    }
  }

  .hidden {
    opacity: 0;
    transform: translateY(12px);
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity var(--motion-duration) var(--motion-easing),
      transform var(--motion-duration) var(--motion-easing),
      visibility var(--motion-duration) var(--motion-easing);
    transition-behavior: allow-discrete;
  }

  @starting-style {
    .floating-new-note:not(.hidden) {
      opacity: 0;
      transform: translateY(12px) scale(0.96);
    }
  }
</style>
