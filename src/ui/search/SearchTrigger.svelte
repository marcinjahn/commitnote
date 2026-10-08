<script lang="ts">
  import { searchIcon } from "../browse/action-icons";
  import { isApplePlatform, searchShortcutHint } from "./search-shortcuts";
  import { SEARCH_TRIGGER_LABEL } from "./search-messages";

  interface Props {
    onOpen: () => void;
  }

  const { onOpen }: Props = $props();

  const apple = isApplePlatform(navigator.userAgent);
</script>

<div class="search-trigger-row">
  <button
    type="button"
    class="search-trigger"
    aria-label={SEARCH_TRIGGER_LABEL}
    aria-haspopup="dialog"
    aria-keyshortcuts={apple ? "Meta+K" : "Control+K"}
    onclick={onOpen}
  >
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {#each searchIcon as d (d)}
        <path {d} />
      {/each}
    </svg>
    <span class="search-trigger-text">Search notes</span>
    <kbd class="search-trigger-hint">{searchShortcutHint(apple)}</kbd>
  </button>
</div>

<style>
  .search-trigger-row {
    padding: var(--space-2);
    border-bottom: var(--hairline) solid var(--color-border);
  }

  .search-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--touch-target);
    padding: 0 var(--space-2);
    border: var(--hairline) solid var(--color-border);
    border-radius: 0;
    background: transparent;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--motion-duration) var(--motion-easing);
  }

  .search-trigger:hover {
    background: var(--color-hover);
  }

  .icon {
    flex-shrink: 0;
  }

  .search-trigger-text {
    flex: 1;
  }

  .search-trigger-hint {
    display: none;
    font-family: inherit;
    font-size: var(--font-size-xs);
  }

  @media (pointer: fine) {
    .search-trigger-hint {
      display: inline;
    }
  }
</style>
