<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    label: Snippet;
    hint?: string;
    hintId?: string;
    stacked?: boolean;
    aside?: Snippet;
    children: Snippet;
  }

  const { label, hint, hintId, stacked = false, aside, children }: Props = $props();
</script>

<div class="setting-row" class:stacked>
  <div class="setting-row-head">
    <div class="setting-row-label-line">
      <span class="setting-row-label">{@render label()}</span>
      {#if aside}
        <span class="setting-row-aside">{@render aside()}</span>
      {/if}
    </div>
    {#if hint}
      <p id={hintId} class="field-hint setting-row-hint">{hint}</p>
    {/if}
  </div>
  <div class="setting-row-control">{@render children()}</div>
</div>

<style>
  .setting-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    min-height: var(--touch-target);
    padding-block: var(--space-2);
  }

  :global(.setting-row + .setting-row) {
    border-top: var(--hairline) solid var(--color-border);
  }

  .setting-row.stacked {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: stretch;
    justify-content: flex-start;
    gap: var(--space-2);
  }

  .setting-row-head {
    flex: 1 1 8rem;
    min-width: 0;
  }

  .stacked .setting-row-head {
    flex: 1 1 auto;
  }

  .setting-row-label-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .setting-row-label {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-medium);
  }

  .setting-row-hint {
    margin: 0;
  }

  .setting-row-control {
    flex: none;
    min-width: 0;
    max-width: 100%;
    margin-inline-start: auto;
  }

  .stacked .setting-row-control {
    flex: 1 1 auto;
    margin-inline-start: 0;
  }
</style>
