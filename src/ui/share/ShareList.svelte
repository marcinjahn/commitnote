<script lang="ts">
  import type { ShareEntry } from "../../share/share-index";
  import { findWorkingNode, type WorkingTree } from "../../sync/working-tree";
  import { noteIcons } from "../browse/action-icons";
  import MenuPopup from "../browse/MenuPopup.svelte";
  import type { MenuAnchor } from "../browse/row-menu-types";
  import { compactShareDate, describeShareDate } from "./share-messages";
  import { shareRowTitle } from "./share-row-title";
  import { shareMenuItems, type ShareMenuId } from "./share-menu";

  interface Props {
    entries: readonly ShareEntry[];
    linkBase: string;
    tree: WorkingTree | null;
    writable: boolean;
    updatingId: string | null;
    onCopyLink: (entry: ShareEntry) => void;
    onCopyPassword: (entry: ShareEntry) => void;
    onUpdate: (entry: ShareEntry) => void;
    onViewVersion: (entry: ShareEntry) => void;
    onOpenNote: ((entry: ShareEntry) => void) | undefined;
    onRevoke: (entry: ShareEntry) => void;
  }

  const {
    entries,
    tree,
    writable,
    updatingId,
    onCopyLink,
    onCopyPassword,
    onUpdate,
    onViewVersion,
    onOpenNote,
    onRevoke,
  }: Props = $props();

  interface OpenMenu {
    entry: ShareEntry;
    anchor: MenuAnchor;
    trigger: HTMLElement;
  }

  let openMenu = $state<OpenMenu | null>(null);
  const triggers = new Map<string, HTMLButtonElement>();

  function menuLabelOf(entry: ShareEntry): string {
    return `Share actions for ${shareRowTitle(entry).title}`;
  }

  function canOpen(entry: ShareEntry): boolean {
    return (
      onOpenNote !== undefined &&
      entry.note.state === "active" &&
      (tree === null || findWorkingNode(tree, entry.note.path) !== undefined)
    );
  }

  function latestDate(entry: ShareEntry): string {
    return entry.updatedAt !== null && entry.updatedAt > entry.sharedAt
      ? entry.updatedAt
      : entry.sharedAt;
  }

  function trackTrigger(node: HTMLButtonElement, id: string) {
    triggers.set(id, node);
    return {
      destroy() {
        if (triggers.get(id) === node) triggers.delete(id);
      },
    };
  }

  function open(entry: ShareEntry, anchor: MenuAnchor): void {
    const trigger = triggers.get(entry.id);
    if (trigger === undefined) return;
    if (openMenu?.entry.id === entry.id && anchor.kind === "rect") {
      handleClose();
      return;
    }
    openMenu = { entry, anchor, trigger };
  }

  function handleTriggerClick(entry: ShareEntry): void {
    if (updatingId === entry.id) return;
    const trigger = triggers.get(entry.id);
    if (trigger === undefined) return;
    open(entry, { kind: "rect", rect: trigger.getBoundingClientRect() });
  }

  function handleContextMenu(event: MouseEvent, entry: ShareEntry): void {
    event.preventDefault();
    event.stopPropagation();
    open(entry, { kind: "point", x: event.clientX, y: event.clientY });
  }

  function handleClose(): void {
    const trigger = openMenu?.trigger ?? null;
    openMenu = null;
    trigger?.focus();
  }

  function handleSelect(id: ShareMenuId): void {
    const entry = openMenu?.entry;
    handleClose();
    if (entry === undefined) return;
    switch (id) {
      case "copy-link":
        onCopyLink(entry);
        break;
      case "copy-password":
        onCopyPassword(entry);
        break;
      case "update":
        onUpdate(entry);
        break;
      case "view":
        onViewVersion(entry);
        break;
      case "open":
        onOpenNote?.(entry);
        break;
      case "revoke":
        onRevoke(entry);
        break;
    }
  }
</script>

<ul class="share-list" data-testid="share-list">
  {#each entries as entry (entry.id)}
    {@const { title, noteName } = shareRowTitle(entry)}
    {@const updating = updatingId === entry.id}
    {@const menuOpen = openMenu?.entry.id === entry.id}
    <li
      class="share-item"
      data-testid="share-item"
      oncontextmenu={(event) => handleContextMenu(event, entry)}
    >
      <span class="share-title">{title}</span>
      {#if noteName !== null}
        <span class="share-note-name">{noteName}</span>
      {/if}
      {#if entry.password !== null}
        <svg class="icon share-lock" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          {#each noteIcons.lock as d (d)}
            <path {d} />
          {/each}
        </svg>
        <span class="visually-hidden">Password protected</span>
      {/if}
      {#if updating}
        <span class="share-date" role="status">Updating…</span>
      {:else}
        <time class="share-date" datetime={latestDate(entry)} title={describeShareDate(entry)}>
          <span aria-hidden="true">{compactShareDate(latestDate(entry), new Date())}</span>
          <span class="visually-hidden">{describeShareDate(entry)}</span>
        </time>
      {/if}
      <button
        type="button"
        class="share-row-actions"
        class:menu-open={menuOpen}
        use:trackTrigger={entry.id}
        aria-label={menuLabelOf(entry)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-disabled={updating}
        onclick={() => handleTriggerClick(entry)}
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="3.5" cy="8" r="1.25" fill="currentColor" stroke="none" />
          <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
          <circle cx="12.5" cy="8" r="1.25" fill="currentColor" stroke="none" />
        </svg>
      </button>
    </li>
  {/each}
</ul>

{#if openMenu !== null}
  <MenuPopup
    label={menuLabelOf(openMenu.entry)}
    items={shareMenuItems(openMenu.entry, {
      canOpen: canOpen(openMenu.entry),
      writable,
      updating: updatingId !== null,
    })}
    anchor={openMenu.anchor}
    trigger={openMenu.trigger}
    onSelect={handleSelect}
    onClose={handleClose}
  />
{/if}

<style>
  .share-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .share-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-1) 0 var(--space-3);
    border-bottom: var(--hairline) solid var(--color-border);
  }

  .share-title,
  .share-note-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .share-title {
    flex: 1 1 auto;
  }

  .share-title:has(+ .share-note-name) {
    flex: 0 1 auto;
  }

  .share-note-name {
    flex: 0 0 auto;
    max-width: 40%;
    margin-inline-end: auto;
    font-size: var(--font-size-sm);
  }

  .share-note-name,
  .share-date,
  .share-lock {
    color: var(--color-text-muted);
  }

  .share-lock {
    flex-shrink: 0;
  }

  .share-date {
    flex-shrink: 0;
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }

  .share-row-actions {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-target);
    height: var(--touch-target);
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    line-height: 1;
    transition:
      background-color var(--motion-duration) var(--motion-easing),
      opacity var(--motion-duration) var(--motion-easing);
  }

  .share-row-actions:hover:not([aria-disabled="true"]) {
    background: color-mix(in srgb, var(--color-text) 8%, transparent);
  }

  .share-row-actions[aria-disabled="true"] {
    cursor: default;
    opacity: 0.5;
  }

  @media (pointer: fine) and (min-width: 768px) {
    .share-row-actions {
      opacity: 0;
    }

    .share-item:hover .share-row-actions,
    .share-item:focus-within .share-row-actions,
    .share-row-actions.menu-open {
      opacity: 1;
    }

    .share-item:hover .share-row-actions[aria-disabled="true"],
    .share-item:focus-within .share-row-actions[aria-disabled="true"] {
      opacity: 0.5;
    }
  }
</style>
