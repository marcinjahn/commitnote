<script lang="ts">
  import { onMount } from "svelte";
  import {
    describeStrength,
    loadStrengthChecker,
    strengthUserInputs,
    type StrengthChecker,
  } from "./passphrase-strength";

  interface Props {
    id: string;
    passphrase: string;
    repositoryLabel: string;
  }

  let { id, passphrase, repositoryLabel }: Props = $props();

  let checker = $state<StrengthChecker | null>(null);

  onMount(() => {
    loadStrengthChecker().then(
      (loaded) => (checker = loaded),
      () => {},
    );
  });

  const result = $derived(
    checker !== null && passphrase !== ""
      ? checker(passphrase, strengthUserInputs(repositoryLabel))
      : null,
  );
  const strength = $derived(
    result === null ? null : describeStrength(result.score),
  );
</script>

<div class="strength">
  {#if result !== null && strength !== null}
    <div class="bar" aria-hidden="true">
      {#each [1, 2, 3, 4] as segment (segment)}
        <span
          class="segment"
          class:filled={segment <= strength.filledSegments}
          class:weak={strength.weak}
        ></span>
      {/each}
    </div>
    <p {id} class="summary">
      <span class="label">Passphrase strength: {strength.label}.</span>
      {#if result.warning !== "" && result.score <= 2}
        {result.warning}
      {/if}
    </p>
  {/if}
</div>
<!-- Announces only when the strength label changes, not on every keystroke. -->
<p class="visually-hidden" aria-live="polite">
  {strength === null ? "" : `Passphrase strength: ${strength.label}.`}
</p>

<style>
  .strength {
    display: grid;
    gap: var(--space-1);
  }

  .bar {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-1);
  }

  .segment {
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--color-border);
    transition: background-color var(--motion-duration) var(--motion-easing);
  }

  .segment.filled {
    background: var(--color-ink);
  }

  .segment.filled.weak {
    background: var(--color-danger);
  }

  .summary {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    overflow-wrap: anywhere;
  }

  .label {
    font-weight: var(--font-weight-medium);
    color: var(--color-text);
  }
</style>
