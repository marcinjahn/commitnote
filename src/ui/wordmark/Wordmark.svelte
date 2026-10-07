<script lang="ts">
  interface Props {
    element?: "h1" | "span";
  }

  const { element = "span" }: Props = $props();

  const LETTERS = [..."commitnote"];
</script>

<svelte:element this={element} class="wordmark">
  <span class="visually-hidden">commitnote</span>
  <span class="wordmark-glyphs" aria-hidden="true">{#each LETTERS as letter, index (index)}<span class="wordmark-letter" class:wordmark-light={index >= 6}>{letter}</span>{/each}</span>
</svelte:element>

<style>
  .wordmark {
    position: relative;
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-tighter);
    line-height: 1.2;
    white-space: nowrap;
    flex-shrink: 0;
    color: var(--color-text);
  }

  .wordmark-light {
    font-weight: 400;
  }
</style>
