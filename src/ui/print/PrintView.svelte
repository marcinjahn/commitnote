<script lang="ts">
  import { onDestroy, flushSync, untrack } from "svelte";
  import { tabTitle } from "../../app/tab-title";
  import { renderPrintMarkdown, showsPrintTitle } from "../../editor/print-markdown";
  import type { PrintNote } from "./print-note";

  interface Props {
    note: PrintNote | null;
  }

  const { note }: Props = $props();

  const RENDER_DEBOUNCE_MS = 300;

  let shown = $state.raw<PrintNote | null>(untrack(() => note));
  let body = $state<HTMLDivElement | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let releaseTitle: (() => void) | null = null;

  function cancelTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  $effect(() => {
    const next = note;
    cancelTimer();
    if (next === null) {
      shown = null;
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      shown = next;
    }, RENDER_DEBOUNCE_MS);
    return cancelTimer;
  });

  $effect(() => {
    if (body === null) return;
    if (shown) body.replaceChildren(renderPrintMarkdown(shown.text));
    else body.replaceChildren();
  });

  function handleBeforePrint(): void {
    cancelTimer();
    shown = note;
    // The browser lays out the print right after this event, before Svelte's microtask flush.
    flushSync();
    if (shown !== null && shown.name !== "") {
      releaseTitle?.();
      releaseTitle = tabTitle.override(shown.name);
    }
  }

  function handleAfterPrint(): void {
    releaseTitle?.();
    releaseTitle = null;
  }

  onDestroy(handleAfterPrint);
</script>

<svelte:window onbeforeprint={handleBeforePrint} onafterprint={handleAfterPrint} />

<div class="print-view">
  {#if shown !== null && showsPrintTitle(shown.name, shown.text)}<header class="print-title">{shown.name}</header>{/if}
  <div class="print-body" bind:this={body}></div>
</div>
