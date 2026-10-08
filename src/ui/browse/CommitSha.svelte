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
  let rolling = $state<readonly boolean[]>([]);

  $effect(() => {
    const next = sha;
    untrack(() => {
      const previous = shown;
      durations = Array.from(next, (char, i) =>
        rollDurationMs(previous[i] ?? char, char),
      );
      rolls = durations.map((ms, i) => (rolls[i] ?? 0) + (ms > 0 ? 1 : 0));
      rolling = durations.map((ms, i) => ms > 0 || (rolling[i] ?? false));
      shown = next;
    });
  });

  const chars = $derived(Array.from(shown));

  function settle(i: number, event: TransitionEvent): void {
    if (event.target !== event.currentTarget) return;
    rolling = rolling.map((value, j) => (j === i ? false : value));
  }
</script>

<span class="commit-sha" data-testid="commit-sha" data-sha={sha}>
  <span class="visually-hidden">Commit {sha}</span>
  <span class="reels" aria-hidden="true">
    {#each chars as char, i (i)}
      {@const index = digitIndex(char)}
      {#if index < 0}
        <span class="reel"><span class="glyph">{char.toUpperCase()}</span></span>
      {:else}
        {@const roll = rolls[i] ?? 0}
        <!-- Alternating between two identical animations restarts the shine on every roll.
             At rest the character is plain text: a translated strip would be placed on its
             own, and at some zoom levels lands a pixel off its neighbours. The strip is
             translated by a percentage and only transitions while rolling, so a zoom
             change does not roll it. -->
        <span
          class="reel"
          class:rolling={rolling[i] ?? false}
          class:shine-a={roll > 0 && roll % 2 === 1}
          class:shine-b={roll > 0 && roll % 2 === 0}
          style:animation-duration="{durations[i] ?? 0}ms"
        >
          <span class="glyph">{HEX_DIGITS[index]}</span>
          <span
            class="strip"
            ontransitionend={(event) => settle(i, event)}
            style:transform="translateY({(-100 * index) / HEX_DIGITS.length}%)"
            style:transition-duration="{rolling[i] ? (durations[i] ?? 0) : 0}ms"
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
    font-size: 0.5625rem;
    font-variant-numeric: lining-nums tabular-nums;
    line-height: var(--reel-height);
    white-space: nowrap;
    --reel-height: 1.3333em;
  }

  .reels {
    display: inline-flex;
  }

  .reel {
    position: relative;
    display: block;
    width: 0.64em;
    height: var(--reel-height);
    text-align: center;
    clip-path: inset(0 -0.25em);
  }

  .glyph {
    display: block;
    height: var(--reel-height);
  }

  .rolling .glyph {
    visibility: hidden;
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
    position: absolute;
    inset: 0 0 auto;
    display: flex;
    flex-direction: column;
    visibility: hidden;
    transition-property: transform;
    transition-timing-function: cubic-bezier(0.45, 0, 0.2, 1);
  }

  .rolling .strip {
    visibility: visible;
  }

  .digit {
    display: block;
    height: var(--reel-height);
  }
</style>
