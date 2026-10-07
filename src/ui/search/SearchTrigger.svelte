<script lang="ts">
  import type { Snippet } from "svelte";
  import { searchIcon } from "../browse/action-icons";
  import { SEARCH_TRIGGER_LABEL } from "./search-messages";

  interface Props {
    onOpen: () => void;
    trailing?: Snippet;
  }

  const { onOpen, trailing }: Props = $props();
</script>

<div class="search-trigger-row">
  <button
    type="button"
    class="search-trigger"
    aria-label={SEARCH_TRIGGER_LABEL}
    aria-haspopup="dialog"
    onclick={onOpen}
  >
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {#each searchIcon as d (d)}
        <path {d} />
      {/each}
    </svg>
    <span class="search-trigger-text">Search notes</span>
  </button>
  {@render trailing?.()}
</div>

<style>
  .search-trigger-row {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2);
    border-bottom: var(--hairline) solid var(--color-border);
  }

  .search-trigger {
    display: flex;
    align-items: center;
    flex: 1;
    gap: var(--space-2);
    min-width: 0;
    min-height: var(--touch-target);
    padding: 0 var(--space-2);
    border: var(--hairline) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--motion-duration) var(--motion-easing), border-color var(--motion-duration) var(--motion-easing);
  }

  .search-trigger:hover {
    background: var(--color-hover);
    border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
  }

  .icon {
    flex-shrink: 0;
  }

  .search-trigger-text {
    flex: 1;
  }
</style>
