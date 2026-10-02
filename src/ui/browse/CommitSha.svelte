<script lang="ts">
  import { untrack } from "svelte";
  import { digitIndex, HEX_DIGITS, rollDurationMs } from "./commit-sha-reel";

  interface Props {
    sha: string;
  }

  const { sha }: Props = $props();

  let shown = $state(untrack(() => sha));
  let durations = $state<readonly number[]>([]);
  let rolls = $state<readonly number[]>([]);

  $effect(() => {
    const next = sha;
    untrack(() => {
      const previous = shown;
      durations = Array.from(next, (char, i) =>
        rollDurationMs(previous[i] ?? char, char),
      );
      rolls = durations.map((ms, i) => (rolls[i] ?? 0) + (ms > 0 ? 1 : 0));
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
        {@const roll = rolls[i] ?? 0}
        <!-- Alternating between two identical animations restarts the shine on every roll. -->
        <span
          class="reel"
          class:shine-a={roll > 0 && roll % 2 === 1}
          class:shine-b={roll > 0 && roll % 2 === 0}
          style:animation-duration="{durations[i] ?? 0}ms"
        >
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
    /* Inter, unlike the system monospace fonts, draws capitals and figures at the same
       height, so A–F line up with the digits; fixed cells stand in for monospacing. */
    font-family: var(--font-sans);
    font-size: 9px;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--reel-height);
    white-space: nowrap;
    --reel-height: 12px;
  }

  .reels {
    display: inline-flex;
  }

  .reel {
    display: inline-block;
    width: 0.64em;
    height: var(--reel-height);
    text-align: center;
    clip-path: inset(0 -0.25em);
  }

  .shine-a {
    animation-name: shine-a;
  }

  .shine-b {
    animation-name: shine-b;
  }

  .shine-a,
  .shine-b {
    animation-timing-function: ease-out;
  }

  @keyframes shine-a {
    30% {
      color: var(--color-text);
      text-shadow: 0 0 3px color-mix(in srgb, var(--color-accent) 45%, transparent);
    }
  }

  @keyframes shine-b {
    30% {
      color: var(--color-text);
      text-shadow: 0 0 3px color-mix(in srgb, var(--color-accent) 45%, transparent);
    }
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
