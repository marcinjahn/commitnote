<script lang="ts">
  import { untrack } from "svelte";
  import { digitIndex, HEX_DIGITS, rollDurationMs } from "./commit-sha-reel";

  interface Props {
    sha: string;
  }

  const { sha }: Props = $props();

  let shown = $state(untrack(() => sha));
  let durations = $state<readonly number[]>([]);

  $effect(() => {
    const next = sha;
    untrack(() => {
      const previous = shown;
      durations = Array.from(next, (char, i) =>
        rollDurationMs(previous[i] ?? char, char),
      );
      shown = next;
    });
  });

  const chars = $derived(Array.from(shown));
</script>

<span class="commit-sha" data-testid="commit-sha" data-sha={sha}>
  <span class="visually-hidden">Commit {sha}</span>
  <span class="reels" aria-hidden="true">
    {#each chars as char, i (i)}
      {@const index = digitIndex(char)}
      {#if index < 0}
        <span class="reel">{char.toUpperCase()}</span>
      {:else}
        <span class="reel">
          <span
            class="strip"
            style:transform="translateY(calc(var(--reel-height) * {-index}))"
            style:transition-duration="{durations[i] ?? 0}ms"
          >
            {#each HEX_DIGITS as digit (digit)}
              <span class="digit">{digit}</span>
            {/each}
          </span>
        </span>
      {/if}
    {/each}
  </span>
</span>

<style>
  .commit-sha {
    display: block;
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 9px;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--reel-height);
    white-space: nowrap;
    /* A whole-pixel row keeps every digit on the same baseline. */
    --reel-height: 12px;
  }

  .reels {
    display: inline-flex;
  }

  .reel {
    display: inline-block;
    height: var(--reel-height);
    overflow: hidden;
  }

  .strip {
    display: flex;
    flex-direction: column;
    transition-property: transform;
    transition-timing-function: cubic-bezier(0.45, 0, 0.2, 1);
    will-change: transform;
  }

  .digit {
    display: block;
    height: var(--reel-height);
  }
</style>
