<script lang="ts">
  import { pullProgress, type PullState } from "./pull-to-refresh";

  interface Props {
    state: PullState;
  }

  const { state }: Props = $props();

  const progress = $derived(state.phase === "refreshing" ? 1 : pullProgress(state));
</script>

<div
  class="pull-indicator"
  data-phase={state.phase}
  aria-hidden="true"
  style:--pull-distance="{state.distance}px"
  style:--pull-progress={progress}
>
  <svg
    class="icon"
    class:spinning={state.phase === "refreshing"}
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.98M13.5 2.5v3.5H10" />
  </svg>
</div>

<style>
  .pull-indicator {
    position: absolute;
    top: 100%;
    left: 50%;
    z-index: 5;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--color-surface-raised);
    border: var(--hairline) solid var(--color-border);
    box-shadow: var(--shadow-1);
    color: var(--color-text-muted);
    pointer-events: none;
    transform: translate(-50%, calc(var(--pull-distance) - 100%));
    transition: transform 150ms var(--motion-easing);
  }

  .pull-indicator[data-phase="idle"] {
    visibility: hidden;
    transition:
      transform 150ms var(--motion-easing),
      visibility 0s 150ms;
  }

  .pull-indicator[data-phase="pulling"],
  .pull-indicator[data-phase="armed"] {
    transition: none;
  }

  .pull-indicator[data-phase="armed"],
  .pull-indicator[data-phase="refreshing"] {
    color: var(--color-accent);
  }

  .icon {
    transform: rotate(calc(var(--pull-progress) * 270deg));
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

  @media (prefers-reduced-motion: reduce) {
    .pull-indicator,
    .pull-indicator[data-phase="idle"] {
      transform: translate(-50%, var(--space-2));
      opacity: var(--pull-progress);
      transition: none;
    }

    .icon {
      transform: none;
    }

    .spinning {
      animation: none;
    }
  }
</style>
