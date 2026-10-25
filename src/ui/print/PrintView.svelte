<script lang="ts">
  import { onDestroy, flushSync, untrack } from "svelte";
  import { tabTitle } from "../../app/tab-title";
  import { renderPrintMarkdown, showsPrintTitle } from "../../editor/print-markdown";
  import type { ImageId } from "../../images/image-id";
  import type { ReadImagePayload } from "../../images/image-resolver";
  import { createPrintImages, type PrintImages } from "./print-images";
  import type { PrintNote } from "./print-note";

  interface Props {
    note: PrintNote | null;
    readImage: ReadImagePayload | null;
  }

  interface RenderKey {
    readonly text: string;
    readonly images: PrintImages | null;
    readonly version: number;
  }

  const { note, readImage }: Props = $props();

  const RENDER_DEBOUNCE_MS = 300;
  const NO_IMAGES: ReadonlyMap<ImageId, string> = new Map();

  let shown = $state.raw<PrintNote | null>(untrack(() => note));
  let body = $state<HTMLDivElement | null>(null);
  let images = $state.raw<PrintImages | null>(null);
  let imagesSettled = $state(0);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let releaseTitle: (() => void) | null = null;
  let rendered: RenderKey | null = null;
  let rendering: RenderKey | null = null;

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
    const read = readImage;
    if (read === null) return;
    const created = createPrintImages({
      readImage: read,
      onSettled: () => imagesSettled++,
    });
    images = created;
    return () => {
      created.reset();
      if (untrack(() => images) === created) images = null;
    };
  });

  function sameKey(a: RenderKey | null, b: RenderKey): boolean {
    return a !== null && a.text === b.text && a.images === b.images && a.version === b.version;
  }

  function swap(target: HTMLDivElement, content: DocumentFragment, key: RenderKey): void {
    rendering = null;
    rendered = key;
    target.replaceChildren(content);
  }

  function update(target: HTMLDivElement, now: boolean): void {
    if (shown === null) {
      images?.reset();
      rendered = null;
      rendering = null;
      target.replaceChildren();
      return;
    }
    images?.show(shown.text);
    const key: RenderKey = { text: shown.text, images, version: images?.version ?? 0 };
    if (sameKey(rendered, key)) {
      rendering = null;
      return;
    }
    if (!now && sameKey(rendering, key)) return;
    const content = renderPrintMarkdown(key.text, document, images?.urls ?? NO_IMAGES);
    const imgs = Array.from(content.querySelectorAll<HTMLImageElement>("img.print-note-image"));
    if (now || imgs.length === 0) {
      swap(target, content, key);
      return;
    }
    rendering = key;
    void Promise.allSettled(imgs.map((img) => img.decode())).then(() => {
      if (rendering === key) swap(target, content, key);
    });
  }

  $effect(() => {
    void imagesSettled;
    void shown;
    void images;
    const target = body;
    if (target === null) return;
    untrack(() => update(target, false));
  });

  function handleBeforePrint(): void {
    cancelTimer();
    shown = note;
    // The browser lays out the print right after this event, before Svelte's microtask flush.
    flushSync();
    if (body !== null) update(body, true);
    if (shown !== null && shown.name !== "") {
      releaseTitle?.();
      releaseTitle = tabTitle.override(shown.name);
    }
  }

  function handleAfterPrint(): void {
    releaseTitle?.();
    releaseTitle = null;
  }

  onDestroy(() => {
    rendering = null;
    handleAfterPrint();
  });
</script>

<svelte:window onbeforeprint={handleBeforePrint} onafterprint={handleAfterPrint} />

<div class="print-view">
  {#if shown !== null && showsPrintTitle(shown.name, shown.text)}<header class="print-title">{shown.name}</header>{/if}
  <div class="print-body" bind:this={body}></div>
</div>
