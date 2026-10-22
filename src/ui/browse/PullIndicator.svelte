<script lang="ts">
  import type { PullPhase } from "./pull-to-refresh";

  interface Props {
    phase: PullPhase;
    chip?: HTMLElement | null;
  }

  let { phase, chip = $bindable(null) }: Props = $props();
</script>

<div class="pull-indicator" data-phase={phase} aria-hidden="true">
  <div class="pull-chip" bind:this={chip}>
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.98M13.5 2.5v3.5H10" pathLength="1" />
    </svg>
  </div>
</div>

<style>
  .pull-indicator {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    height: 128px;
    overflow: hidden;
    pointer-events: none;
    z-index: 5;
    transition: visibility 0s;
  }

  .pull-indicator[data-phase="idle"] {
    visibility: hidden;
    transition: visibility 0s 260ms;
  }

  .pull-chip {
    position: absolute;
    top: 0;
    left: 50%;
    margin-left: -16px;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    border: var(--hairline) solid var(--color-border);
    box-shadow: var(--shadow-1);
    color: var(--color-text-muted);
    opacity: clamp(0, calc(var(--pull-progress, 0) * 3), 1);
    transform: translateY(-32px);
  }

  .icon {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    transform: rotate(calc(var(--pull-progress, 0) * 270deg));
  }

  .icon path {
    stroke-dasharray: 1;
    stroke-dashoffset: calc(1 - var(--pull-progress, 0));
  }

  .pull-indicator[data-phase="armed"] .pull-chip {
    color: var(--color-accent);
    border-color: var(--color-accent);
    animation: pop 180ms var(--motion-easing);
  }

  .pull-indicator[data-phase="refreshing"] .pull-chip {
    color: var(--color-accent);
  }

  .pull-indicator[data-phase="refreshing"] .icon {
    animation: spin 0.8s linear infinite;
  }

  .pull-indicator[data-phase="refreshing"] .icon path {
    stroke-dashoffset: 0;
  }

  @keyframes pop {
    0%,
    100% {
      scale: 1;
    }
    50% {
      scale: 1.08;
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

  @media (prefers-reduced-motion: reduce) {
    .pull-indicator,
    .pull-indicator[data-phase="idle"] {
      transition: none;
    }

    .pull-chip {
      transform: translateY(8px);
      transition: none;
      animation: none;
    }

    .icon,
    .pull-indicator[data-phase="refreshing"] .icon {
      transform: none;
      transition: none;
      animation: none;
    }
  }
</style>
