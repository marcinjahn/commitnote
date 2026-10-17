<script lang="ts">
  interface Props {
    refreshing: boolean;
    feedback: "success" | "error" | null;
    onRefresh: () => void;
  }

  const { refreshing, feedback, onRefresh }: Props = $props();

  const glyph = $derived(refreshing || feedback === null ? "refresh" : feedback);
</script>

<button
  type="button"
  class="button button-icon button-ghost refresh-button"
  aria-label="Refresh"
  aria-busy={refreshing}
  data-feedback={glyph === "refresh" ? undefined : glyph}
  disabled={refreshing}
  onclick={() => onRefresh()}
>
  <span class="glyph" class:active={glyph === "refresh"}>
    <svg
      class="icon"
      class:spinning={refreshing}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.98M13.5 2.5v3.5H10" />
    </svg>
  </span>
  <span class="glyph success" class:active={glyph === "success"}>
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path class="draw" pathLength="1" d="M3 8.5l3.5 3.5 6.5-7.5" />
    </svg>
  </span>
  <span class="glyph error" class:active={glyph === "error"}>
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path class="draw" pathLength="1" d="M4 4l8 8M12 4l-8 8" />
    </svg>
  </span>
</button>
<span class="visually-hidden" role="status">
  {glyph === "success" ? "Refreshed" : ""}
</span>

<style>
  .refresh-button {
    display: inline-grid;
    place-items: center;
  }

  .glyph {
    grid-area: 1 / 1;
    display: inline-flex;
    opacity: 0;
    transform: scale(0.4) rotate(-45deg);
    transition:
      opacity 180ms var(--motion-easing),
      transform 260ms var(--motion-easing);
  }

  .glyph.active {
    opacity: 1;
    transform: none;
  }

  .success {
    color: var(--color-accent);
  }

  .error {
    color: var(--color-danger);
  }

  .draw {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    transition: stroke-dashoffset 320ms var(--motion-easing) 60ms;
  }

  .active .draw {
    stroke-dashoffset: 0;
  }

  .spinning {
    animation: spin 0.8s linear infinite;
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
