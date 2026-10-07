<script lang="ts">
  import { tick, untrack } from "svelte";
  import {
    driveTypedWordmark,
    initialTypingPhase,
    type TypingPhase,
  } from "./typed-wordmark";
  import { TAIL_FADE_MS } from "./typing-schedule";

  interface Props {
    element?: "h1" | "span";
    typed?: boolean;
  }

  const { element = "span", typed = false }: Props = $props();

  const TEXT = "commitnote";
  const LETTERS = [...TEXT];
  const BEAT_BEFORE_INDEX = 6;
  const TAIL_LENGTH = 3;
  const CARET_HEIGHT_EM = 1.1;

  let root = $state<HTMLElement>();
  let phase = $state<TypingPhase | undefined>(
    untrack(() => typed) ? initialTypingPhase() : undefined,
  );
  let typedCount = $state(0);
  let caretVisible = $state(true);
  let caret = $state<{ left: number; top: number; height: number }>();

  const animating = $derived(phase === "typing" || phase === "blinking");
  const tailStart = $derived(typedCount - Math.min(TAIL_LENGTH, typedCount));

  function accentMix(fraction: number): string {
    const percent = Math.round(fraction * 100_000) / 1000;
    return `color-mix(in oklab, currentColor, var(--color-accent) calc(var(--wordmark-tail) * ${percent}%))`;
  }

  function tailStyle(index: number): string | undefined {
    if (!animating || index < tailStart || index >= typedCount) return;
    const length = typedCount - tailStart;
    const position = index - tailStart;
    return `background-image: linear-gradient(90deg, ${accentMix(position / length)}, ${accentMix((position + 1) / length)})`;
  }

  function measureCaret(): void {
    const node = root;
    if (!node || node.getClientRects().length === 0) return;
    const letters = node.querySelectorAll<HTMLElement>(".wordmark-letter");
    const last = letters[typedCount - 1];
    const left = last
      ? last.offsetLeft + last.offsetWidth
      : letters[0].offsetLeft;
    const height = Math.round(
      CARET_HEIGHT_EM * parseFloat(getComputedStyle(node).fontSize),
    );
    caret = {
      left: Math.round(left),
      top: Math.round((node.clientHeight - height) / 2),
      height,
    };
  }

  $effect(() => {
    const node = root;
    if (!node || untrack(() => phase) !== "typing") return;
    untrack(measureCaret);
    return driveTypedWordmark(node, TEXT, BEAT_BEFORE_INDEX, {
      onStart: measureCaret,
      async onType(count) {
        typedCount = count;
        await tick();
        measureCaret();
      },
      onFade() {
        phase = "blinking";
      },
      onCaret(visible) {
        caretVisible = visible;
      },
      onDone() {
        phase = "done";
      },
    });
  });
</script>

<svelte:element
  this={element}
  bind:this={root}
  class="wordmark"
  data-typing={phase}
  style={phase === "blinking"
    ? `--wordmark-tail: 0; transition: --wordmark-tail ${TAIL_FADE_MS}ms ease-out`
    : undefined}
>
  <span class="visually-hidden">commitnote</span>
  <span class="wordmark-glyphs" aria-hidden="true">{#each LETTERS as letter, index (index)}<span class="wordmark-letter" class:wordmark-light={index >= 6} class:wordmark-untyped={phase === "typing" && index >= typedCount} class:wordmark-tail={tailStyle(index) !== undefined} style={tailStyle(index)}>{letter}</span>{/each}</span>{#if animating && caret}<span class="wordmark-caret" aria-hidden="true" style="left: {caret.left}px; top: {caret.top}px; height: {caret.height}px;{caretVisible ? '' : ' visibility: hidden;'}"></span>{/if}
</svelte:element>

<style>
  .wordmark {
    position: relative;
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-tighter);
    line-height: 1.2;
    white-space: nowrap;
    flex-shrink: 0;
    color: var(--color-text);
  }

  .wordmark-light {
    font-weight: 400;
  }

  .wordmark-untyped {
    visibility: hidden;
  }

  .wordmark-tail {
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .wordmark-caret {
    position: absolute;
    width: 2px;
    background: var(--color-accent);
    pointer-events: none;
  }
</style>
