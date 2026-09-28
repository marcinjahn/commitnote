<script lang="ts">
  import { renderMarkdown } from "../../markdown/render-markdown";

  interface Props {
    content: string;
  }

  const { content }: Props = $props();

  const html = $derived(renderMarkdown(content));
</script>

<article aria-label="Reading view">
  {@html html}
</article>

<style>
  article {
    max-width: var(--content-max-width);
    margin: 0 auto;
    padding: var(--space-4) var(--space-3);
  }

  article :global(h1),
  article :global(h2),
  article :global(h3),
  article :global(h4),
  article :global(h5),
  article :global(h6) {
    margin: var(--space-4) 0 var(--space-2);
  }

  article :global(h1:first-child),
  article :global(h2:first-child),
  article :global(h3:first-child) {
    margin-top: 0;
  }

  article :global(p) {
    margin: 0 0 var(--space-3);
  }

  article :global(ul),
  article :global(ol) {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-4);
  }

  article :global(li) {
    margin-bottom: var(--space-1);
  }

  article :global(.task-list-container) {
    list-style: none;
    padding-left: 0;
  }

  article :global(.task-list-item) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  article :global(.task-list-item-checkbox) {
    margin: 0;
  }

  article :global(blockquote) {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-3);
    border-left: 3px solid var(--color-border);
    color: var(--color-text-muted);
  }

  article :global(code) {
    font-family: var(--font-mono);
    background: var(--color-code-surface);
    padding: 0.15em 0.35em;
    border-radius: var(--radius-sm);
    font-size: 0.9em;
  }

  article :global(pre) {
    margin: 0 0 var(--space-3);
    padding: var(--space-3);
    background: var(--color-code-surface);
    border-radius: var(--radius);
    overflow-x: auto;
  }

  article :global(pre code) {
    padding: 0;
    background: none;
    font-size: var(--font-size-sm);
  }

  article :global(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    margin: 0 0 var(--space-3);
    border-collapse: collapse;
  }

  article :global(th),
  article :global(td) {
    border: 1px solid var(--color-border);
    padding: var(--space-1) var(--space-2);
  }

  article :global(img) {
    max-width: 100%;
    height: auto;
  }
</style>
