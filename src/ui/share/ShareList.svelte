<script lang="ts">
  import type { ShareEntry } from "../../share/share-index";
  import { findWorkingNode, type WorkingTree } from "../../sync/working-tree";
  import { noteIcons } from "../browse/action-icons";
  import { describeSharedAt } from "./share-messages";

  interface Props {
    entries: readonly ShareEntry[];
    linkBase: string;
    tree: WorkingTree | null;
    writable: boolean;
    onCopyLink: (entry: ShareEntry) => void;
    onCopyPassword: (entry: ShareEntry) => void;
    onViewVersion: (entry: ShareEntry) => void;
    onOpenNote: ((entry: ShareEntry) => void) | undefined;
    onRevoke: (entry: ShareEntry) => void;
  }

  const {
    entries,
    tree,
    writable,
    onCopyLink,
    onCopyPassword,
    onViewVersion,
    onOpenNote,
    onRevoke,
  }: Props = $props();

  function titleOf(entry: ShareEntry): string {
    const { note } = entry;
    if (note.state === "active") return note.path[note.path.length - 1];
    if (note.state === "trashed") return entry.name;
    return "Deleted note";
  }

  function canOpen(entry: ShareEntry): boolean {
    return (
      onOpenNote !== undefined &&
      entry.note.state === "active" &&
      (tree === null || findWorkingNode(tree, entry.note.path) !== undefined)
    );
  }
</script>

<ul class="share-list" data-testid="share-list">
  {#each entries as entry (entry.id)}
    {@const title = titleOf(entry)}
    <li class="share-item" data-testid="share-item">
      <div class="share-title">
        <span class="share-name">{title}</span>
        {#if entry.note.state === "trashed"}
          <span class="muted"> · In trash</span>
        {:else if entry.note.state === "deleted"}
          <span class="muted"> · {entry.name}</span>
        {/if}
      </div>
      <div class="share-detail">
        <span>{describeSharedAt(entry.sharedAt)}</span>
        {#if entry.password !== null}
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            {#each noteIcons.lock as d (d)}
              <path {d} />
            {/each}
          </svg>
          <span class="visually-hidden">Password protected</span>
        {/if}
      </div>
      <div class="share-actions">
        <button
          type="button"
          class="button button-ghost"
          aria-label={`Copy link for ${title}`}
          onclick={() => onCopyLink(entry)}>Copy link</button
        >
        {#if entry.password !== null}
          <button
            type="button"
            class="button button-ghost"
            aria-label={`Copy password for ${title}`}
            onclick={() => onCopyPassword(entry)}>Copy password</button
          >
        {/if}
        <button
          type="button"
          class="button button-ghost"
          aria-label={`View shared version of ${title}`}
          onclick={() => onViewVersion(entry)}>View shared version</button
        >
        {#if canOpen(entry)}
          <button
            type="button"
            class="button button-ghost"
            aria-label={`Open note ${title}`}
            onclick={() => onOpenNote?.(entry)}>Open note</button
          >
        {/if}
        <button
          type="button"
          class="button button-ghost"
          aria-label={`Revoke link for ${title}`}
          disabled={!writable}
          onclick={() => onRevoke(entry)}>Revoke</button
        >
      </div>
    </li>
  {/each}
</ul>

<style>
  .share-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .share-item {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
    border-bottom: var(--hairline) solid var(--color-border);
  }

  .share-name {
    overflow-wrap: anywhere;
  }

  .muted,
  .share-detail {
    color: var(--color-text-muted);
  }

  .share-detail {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
  }

  .share-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-left: calc(-1 * var(--space-2));
    font-size: var(--font-size-sm);
  }
</style>
