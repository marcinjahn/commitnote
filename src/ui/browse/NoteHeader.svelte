<script lang="ts">
  interface Props {
    name: string;
    refreshing: boolean;
    onRefresh: () => void;
    onBack: () => void;
  }

  const { name, refreshing, onRefresh, onBack }: Props = $props();
</script>

<header class="note-header">
  <button type="button" class="button button-ghost back-button" onclick={onBack}>
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M10 3L5 8l5 5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    Back to notes
  </button>
  <h2 class="note-title" title={name}>{name}</h2>
  <button
    type="button"
    class="button button-icon"
    aria-label="Refresh"
    aria-busy={refreshing}
    disabled={refreshing}
    onclick={onRefresh}
  >
    <svg
      class="refresh-icon"
      class:spinning={refreshing}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.7-3.98M13.5 2.5v3.5H10"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</header>

<style>
  .note-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
  }

  .back-button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .back-button svg {
    flex-shrink: 0;
  }

  .note-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0;
  }

  .refresh-icon.spinning {
    animation: spin 0.8s linear infinite;
  }

  @media (min-width: 768px) {
    .back-button {
      display: none;
    }
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
