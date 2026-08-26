<script lang="ts">
  interface Props {
    element?: "h1" | "span";
  }

  const { element = "span" }: Props = $props();
</script>

<svelte:element this={element} class="wordmark">commitnote</svelte:element>

<style>
  .wordmark {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-tighter);
    line-height: 1.2;
    white-space: nowrap;
    flex-shrink: 0;
    color: var(--color-text);
  }
</style>
