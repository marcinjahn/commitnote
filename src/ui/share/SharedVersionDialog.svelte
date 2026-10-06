<script lang="ts">
  import { livePreview } from "../../editor/live-preview";
  import { linkOpen } from "../../editor/link-open";
  import type { NoteHistory, VersionContent } from "../../history/note-history";
  import type { NoteFont } from "../../settings/note-font";
  import type { ShareEntry } from "../../share/share-index";
  import { describeSyncError } from "../browse/sync-messages";
  import Dialog from "../dialogs/Dialog.svelte";
  import MarkdownEditor from "../editor/MarkdownEditor.svelte";
  import { describeShareDate } from "./share-messages";

  interface Props {
    entry: ShareEntry;
    noteHistory: NoteHistory;
    forgeName: string;
    noteFont: NoteFont;
    onClose: () => void;
  }

  const { entry, noteHistory, forgeName, noteFont, onClose }: Props = $props();

  const editorExtensions = [livePreview(), linkOpen()];
  const GONE_MESSAGE =
    "The shared version is no longer in your history. The link still works.";
  const PASSPHRASE_CHANGED_MESSAGE =
    "The shared version is no longer in your history. Your passphrase was changed after this note was shared. The link still works.";

  let content = $state<VersionContent | null>(null);
  let attempt = $state(0);

  $effect(() => {
    void attempt;
    const { source } = entry;
    if (source === null) return;
    content = null;
    let current = true;
    noteHistory
      .readVersion({
        sha: source.commit,
        storedPath: source.storedPath,
        committedAt: 0,
        name: null,
        events: [],
      })
      .catch((): VersionContent => ({ kind: "failed", error: { kind: "server" } }))
      .then((result) => {
        if (current) content = result;
      });
    return () => {
      current = false;
    };
  });
</script>

<Dialog open={true} wide closeButton title="Shared version" {onClose}>
  {#snippet children()}
    <p class="version-date">{describeShareDate(entry)}</p>
    {#if entry.source === null}
      <p class="version-message">{PASSPHRASE_CHANGED_MESSAGE}</p>
    {:else if content === null}
      <div class="skeleton" aria-hidden="true">
        <span class="skeleton-bar short"></span>
        {#each [0, 1, 2, 3, 4, 5] as i (i)}
          <span class="skeleton-bar" style="--i: {i}"></span>
        {/each}
      </div>
      <span class="visually-hidden" role="status">Loading shared version…</span>
    {:else if content.kind === "readable"}
      <MarkdownEditor
        text={content.content}
        readOnly={true}
        onChange={() => {}}
        extensions={editorExtensions}
        ariaLabel="Shared version"
        {noteFont}
      />
    {:else if content.kind === "undecryptable" || (content.kind === "failed" && content.error.kind === "notFound")}
      <p class="version-message">{GONE_MESSAGE}</p>
    {:else}
      <div class="version-message version-error" role="alert">
        <span>{describeSyncError(content.error, forgeName)}</span>
        <button type="button" class="button" onclick={() => attempt++}>Try again</button>
      </div>
    {/if}
  {/snippet}
</Dialog>

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
