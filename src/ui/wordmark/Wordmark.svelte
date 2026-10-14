<script lang="ts">
  import { tick, untrack } from "svelte";
  import {
    driveTypedWordmark,
    initialTypingPhase,
    type TypingPhase,
  } from "./typed-wordmark";
  import {
    CARET_SOFT_EDGE,
    CARET_TAIL_LENGTH,
    CARET_WIDTH_PX,
    caretTailStops,
  } from "../../editor/caret-style";

  interface Props {
    element?: "h1" | "span";
    typed?: boolean;
  }

  const { element = "span", typed = false }: Props = $props();

  const TEXT = "commitnote";
  const LETTERS = [...TEXT];
  const BEAT_BEFORE_INDEX = 6;
  const CARET_HEIGHT_EM = 1.1;

  let root = $state<HTMLElement>();
  let phase = $state<TypingPhase | undefined>(
    untrack(() => typed) ? initialTypingPhase() : undefined,
  );
  let typedCount = $state(0);
  let lit = $state(true);
  let caret = $state<{ left: number; top: number; height: number }>();

  const animating = $derived(phase === "typing" || phase === "blinking");
  const tailStart = $derived(
    typedCount - Math.min(CARET_TAIL_LENGTH, typedCount),
  );

  function accentMix(fraction: number): string {
    const percent = Math.round(fraction * 100_000) / 1000;
    return `color-mix(in oklab, currentColor, var(--color-accent) calc(var(--wordmark-tail) * ${percent}%))`;
  }

  function tailStyle(index: number): string | undefined {
    if (!animating || index < tailStart || index >= typedCount) return;
    const stops = caretTailStops(typedCount - tailStart);
    const position = index - tailStart;
    return `background-image: linear-gradient(90deg, ${accentMix(stops[position])}, ${accentMix(stops[position + 1])})`;
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
      onBlink() {
        phase = "blinking";
      },
      onCaret(visible) {
        lit = visible;
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
  data-caret={animating ? (lit ? "on" : "off") : undefined}
  style={animating
    ? `--wordmark-tail: ${lit ? 1 : 0}; transition: --wordmark-tail ${CARET_SOFT_EDGE}`
    : undefined}
>
  <span class="visually-hidden">commitnote</span>
  <span class="wordmark-glyphs" aria-hidden="true">{#each LETTERS as letter, index (index)}<span class="wordmark-letter" class:wordmark-regular={index >= 6} class:wordmark-untyped={phase === "typing" && index >= typedCount} class:wordmark-tail={tailStyle(index) !== undefined} style={tailStyle(index)}>{letter}</span>{/each}</span>{#if animating && caret}<span class="wordmark-caret" aria-hidden="true" style="left: {caret.left}px; top: {caret.top}px; height: {caret.height}px; width: {CARET_WIDTH_PX}px; opacity: {lit ? 1 : 0}; transition: opacity {CARET_SOFT_EDGE};"></span>{/if}
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

  .wordmark-regular {
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
    background: var(--color-accent);
    pointer-events: none;
  }

  @media (forced-colors: active) {
    .wordmark-tail {
      -webkit-text-fill-color: CanvasText;
      background-image: none !important;
    }

    .wordmark-caret {
      forced-color-adjust: none;
      background: CanvasText;
    }
  }
</style>
