<script lang="ts">
  import { sortedShares, type ShareEntry, type ShareIndex } from "../../share/share-index";
  import type { WorkingTree } from "../../sync/working-tree";
  import Dialog from "../dialogs/Dialog.svelte";
  import {
    describeShareError,
    messageText,
    SHARED_LINKS_EMPTY,
    SHARED_LINKS_TITLE,
  } from "./share-messages";
  import ShareList from "./ShareList.svelte";

  interface Props {
    open: boolean;
    shares: ShareIndex | null;
    tree: WorkingTree | null;
    linkBase: string;
    onCopyLink: (entry: ShareEntry) => void;
    onCopyPassword: (entry: ShareEntry) => void;
    onViewVersion: (entry: ShareEntry) => void;
    updatingId: string | null;
    onUpdate: (entry: ShareEntry) => void;
    onOpenNote: (entry: ShareEntry) => void;
    onRename: (entry: ShareEntry) => void;
    onRevoke: (entry: ShareEntry) => void;
    onClose: () => void;
  }

  const {
    open,
    shares,
    tree,
    linkBase,
    onCopyLink,
    onCopyPassword,
    onViewVersion,
    updatingId,
    onUpdate,
    onOpenNote,
    onRename,
    onRevoke,
    onClose,
  }: Props = $props();

  const unreadable = $derived(shares !== null && !shares.writable);
</script>

<Dialog {open} title={SHARED_LINKS_TITLE} large closeButton {onClose}>
  {#snippet children()}
    {#if unreadable}
      <p class="alert-error" role="alert">
        {messageText(describeShareError({ kind: "sharesUnavailable" }, "github"))}
      </p>
    {/if}
    {#if shares === null || shares.entries.size === 0}
      {#if !unreadable}
        <p class="empty">{SHARED_LINKS_EMPTY}</p>
      {/if}
    {:else}
      <ShareList
        entries={sortedShares(shares)}
        {linkBase}
        {tree}
        writable={shares.writable}
        {onCopyLink}
        {onCopyPassword}
        {onViewVersion}
        {updatingId}
        {onUpdate}
        {onOpenNote}
        {onRename}
        {onRevoke}
      />
    {/if}
  {/snippet}
</Dialog>

<style>
  .empty {
    margin: 0;
    padding: 0 var(--space-3);
    color: var(--color-text-muted);
  }
</style>
