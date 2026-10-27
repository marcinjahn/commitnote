<script lang="ts">
  import {
    imageOpenHandler,
    imageSource as imageSourceFacet,
    imageWidgets,
    type ImageOpenRequest,
  } from "../../editor/image-widgets";
  import { tableWidgets } from "../../editor/table-widgets";
  import { livePreview } from "../../editor/live-preview";
  import { linkOpen } from "../../editor/link-open";
  import { readSharedVersion, type SharedVersionOutcome } from "../../app/shared-version";
  import type { NoteHistory } from "../../history/note-history";
  import type { ImageSource } from "../../images/image-source";
  import type { NoteFont } from "../../settings/note-font";
  import type { ShareEntry } from "../../share/share-index";
  import Dialog from "../dialogs/Dialog.svelte";
  import MarkdownEditor from "../editor/MarkdownEditor.svelte";
  import { loadImageLightbox } from "../images/load-image-lightbox";
  import {
    describeShareDate,
    LOADING_SHARED_VERSION_TEXT,
    SHARED_VERSION_PASSPHRASE_CHANGED_MESSAGE,
    SHARED_VERSION_TITLE,
    TRY_AGAIN_LABEL,
  } from "./share-messages";

  interface Props {
    entry: ShareEntry;
    noteHistory: NoteHistory;
    forgeName: string;
    noteFont: NoteFont;
    imageSource: ImageSource;
    onClose: () => void;
  }

  const { entry, noteHistory, forgeName, noteFont, imageSource, onClose }: Props = $props();

  const editorExtensions = [
    livePreview(),
    imageWidgets(),
    tableWidgets(),
    imageSourceFacet.of((id) => imageSource(id)),
    imageOpenHandler.of(openImage),
    linkOpen(),
  ];

  type LightboxComponent = Awaited<ReturnType<typeof loadImageLightbox>>;

  let lightbox = $state.raw<{
    component: LightboxComponent;
    url: string;
    request: ImageOpenRequest;
  } | null>(null);
  let opening = false;

  async function openImage(request: ImageOpenRequest): Promise<void> {
    if (opening || lightbox !== null) return;
    opening = true;
    try {
      const [component, source] = await Promise.all([
        loadImageLightbox(),
        imageSource(request.imageId),
      ]);
      if ("unavailable" in source) return;
      lightbox = { component, url: source.url, request };
    } catch {
      return;
    } finally {
      opening = false;
    }
  }

  let outcome = $state<SharedVersionOutcome | null>(null);
  let attempt = $state(0);

  $effect(() => {
    void attempt;
    if (entry.source === null) return;
    outcome = null;
    let current = true;
    void readSharedVersion({ noteHistory, forgeName }, entry).then((result) => {
      if (current) outcome = result;
    });
    return () => {
      current = false;
    };
  });
</script>

<Dialog open={true} wide closeButton title={SHARED_VERSION_TITLE} {onClose}>
  {#snippet children()}
    <p class="version-date">{describeShareDate(entry)}</p>
    {#if entry.source === null}
      <p class="version-message">{SHARED_VERSION_PASSPHRASE_CHANGED_MESSAGE}</p>
    {:else if outcome === null}
      <div class="skeleton" aria-hidden="true">
        <span class="skeleton-bar short"></span>
        {#each [0, 1, 2, 3, 4, 5] as i (i)}
          <span class="skeleton-bar" style="--i: {i}"></span>
        {/each}
      </div>
      <span class="visually-hidden" role="status">{LOADING_SHARED_VERSION_TEXT}</span>
    {:else if outcome.kind === "readable"}
      <MarkdownEditor
        text={outcome.content}
        noteSwitch={0}
        readOnly={true}
        onChange={() => {}}
        extensions={editorExtensions}
        ariaLabel={SHARED_VERSION_TITLE}
        {noteFont}
      />
    {:else if outcome.kind === "message"}
      <p class="version-message">{outcome.message}</p>
    {:else}
      <div class="version-message version-error" role="alert">
        <span>{outcome.message}</span>
        <button type="button" class="button" onclick={() => attempt++}>{TRY_AGAIN_LABEL}</button>
      </div>
    {/if}
  {/snippet}
</Dialog>
{#if lightbox}
  {@const request = lightbox.request}
  <lightbox.component.default
    url={lightbox.url}
    alt={request.alt}
    width={request.width}
    height={request.height}
    origin={request.thumbnail}
    onClose={() => (lightbox = null)}
  />
{/if}

<style>
  .version-date,
  .version-message {
    margin: 0 0 var(--space-3);
    padding-inline: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .version-error {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
    color: var(--color-danger);
  }

  .skeleton {
    display: grid;
    gap: var(--space-2);
    padding-inline: var(--space-3);
  }

  .skeleton-bar {
    display: block;
    height: 0.75rem;
    width: calc(90% - var(--i, 0) * 7%);
    background: var(--color-hover);
    animation: skeleton-pulse 1.2s var(--motion-easing) infinite alternate;
    animation-delay: calc(var(--i, 0) * 80ms);
  }

  .skeleton-bar.short {
    width: 40%;
    margin-bottom: var(--space-2);
  }

  @keyframes skeleton-pulse {
    to {
      opacity: 0.4;
    }
  }
</style>
