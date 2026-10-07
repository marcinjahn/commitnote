<script lang="ts">
  import type { NotePath } from "../../changes/change";
  import { notePathEquals } from "../../changes/change";
  import type { SyncStates } from "../../sync/sync-state";
  import type { WorkingNode } from "../../sync/working-tree";
  import NoteTreeFolder from "./NoteTreeFolder.svelte";
  import type { MenuAnchor } from "./row-menu-types";
  import SyncStateIcon from "./SyncStateIcon.svelte";
  import { syncIndicatorFade } from "./sync-indicator-fade";
  import { describeSyncState } from "./sync-messages";
  import { describeColorTag } from "./tag-messages";
  import NoteIcon from "./NoteIcon.svelte";
  import { noteIcons } from "./action-icons";

  interface Props {
    node: WorkingNode;
    depth: number;
    selectedPath: NotePath | null;
    syncStates: SyncStates;
    isExpanded: (key: string) => boolean;
    onToggle: (key: string) => void;
    onSelect: (path: NotePath) => void;
    menuOpenKey: string | null;
    onOpenMenu: (
      key: string,
      node: WorkingNode,
      anchor: MenuAnchor,
      trigger: HTMLElement,
    ) => void;
  }

  const {
    node,
    depth,
    selectedPath,
    syncStates,
    isExpanded,
    onToggle,
    onSelect,
    menuOpenKey,
    onOpenMenu,
  }: Props = $props();

  const key = $derived(node.path.join("/"));
  const expanded = $derived(node.kind === "folder" && isExpanded(key));
  const selected = $derived(
    node.kind === "note" &&
      selectedPath !== null &&
      notePathEquals(node.path, selectedPath),
  );
  const syncState = $derived(syncStates.stateOf(node.path));
  const unsynced = $derived(
    syncState.kind === "syncing" ||
      (syncState.kind === "out-of-sync" && syncState.reason === "pending"),
  );
  const showsSyncIcon = $derived(
    syncState.kind === "out-of-sync" && syncState.reason !== "pending",
  );
  const menuOpen = $derived(menuOpenKey === key);
  const statusId = $props.id();
  const tagId = `${statusId}-tag`;
  const colorTag = $derived(node.kind === "note" ? node.colorTag : null);
  const shareId = `${statusId}-share`;
  const shared = $derived(node.kind === "note" && node.shared);
  const describedBy = $derived(
    [
      colorTag !== null ? tagId : null,
      shared ? shareId : null,
      unsynced ? statusId : null,
    ]
      .filter((id) => id !== null)
      .join(" ") || undefined,
  );

  // The sweep outlives the saving state until its overlay has faded out
  // (--sync-label-fade), so stopping it is invisible.
  const SWEEP_SETTLE_MS = 500;
  let sweeping = $state(false);
  $effect(() => {
    if (syncState.kind === "syncing") {
      sweeping = true;
      return;
    }
    if (!sweeping) return;
    const timer = setTimeout(() => (sweeping = false), SWEEP_SETTLE_MS);
    return () => clearTimeout(timer);
  });

  let actionsButton: HTMLButtonElement | undefined = $state();

  function handleActivate(): void {
    if (node.kind === "folder") {
      onToggle(key);
    } else {
      onSelect(node.path);
    }
  }

  function handleActionsClick(): void {
    if (actionsButton === undefined) return;
    onOpenMenu(
      key,
      node,
      { kind: "rect", rect: actionsButton.getBoundingClientRect() },
      actionsButton,
    );
  }

  function handleContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (actionsButton === undefined) return;
    onOpenMenu(
      key,
      node,
      { kind: "point", x: event.clientX, y: event.clientY },
      actionsButton,
    );
  }
</script>

<li role="none" oncontextmenu={handleContextMenu}>
  <div
    class="tree-row-container"
    class:selected
    data-tree-row
    data-tree-path={JSON.stringify(node.path)}
    data-tree-kind={node.kind}
  >
  <button
    type="button"
    role="treeitem"
    class="tree-row"
    style="--depth: {depth}"
    aria-expanded={node.kind === "folder" ? expanded : undefined}
    aria-selected={node.kind === "note" ? selected : undefined}
    title={node.name}
    aria-describedby={describedBy}
    data-unsynced={unsynced ? "" : undefined}
    data-drag-handle
    onclick={handleActivate}
  >
    {#if node.kind === "folder"}
      <svg
        class="icon row-icon chevron"
        class:expanded
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M6 3.5L10.5 8 6 12.5" />
      </svg>
      <svg
        class="icon row-icon"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M1.5 3.5h4L7 5h7.5v8.5h-13z" />
      </svg>
    {:else}
      <NoteIcon {colorTag} muted />
    {/if}
    <span
      class="tree-row-label"
      class:unsynced
      class:saving={syncState.kind === "syncing"}
      class:sweeping
      data-drag-label
      data-name={node.name}>{node.name}</span
    >
    {#if shared}
      <svg
        class="share-glyph"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        {#each noteIcons.share as d (d)}
          <path {d} />
        {/each}
      </svg>
    {/if}
  </button>
  {#if colorTag !== null}
    <span id={tagId} class="visually-hidden">{describeColorTag(colorTag)}</span>
  {/if}
  {#if shared}
    <span id={shareId} class="visually-hidden">Shared</span>
  {/if}
  {#if unsynced}
    <span id={statusId} class="visually-hidden"
      >{describeSyncState(syncState)}</span
    >
  {/if}
  {#if showsSyncIcon}
    <span
      class="sync-indicator"
      data-drag-omit
      in:syncIndicatorFade={{ duration: 200 }}
      out:syncIndicatorFade={{ duration: 400 }}
    >
      <SyncStateIcon state={syncState} />
    </span>
  {/if}
  <button
    type="button"
    class="row-actions"
    class:menu-open={menuOpen}
    data-drag-omit
    bind:this={actionsButton}
    aria-label={`Actions for ${node.name}`}
    aria-haspopup="menu"
    onclick={handleActionsClick}
  >
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="3.5" cy="8" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  </button>
  </div>
  {#if node.kind === "folder" && expanded && node.children.length > 0}
    <ul role="group">
      {#each node.children as child (child.path.join("/"))}
        <NoteTreeFolder
          node={child}
          depth={depth + 1}
          {selectedPath}
          {syncStates}
          {isExpanded}
          {onToggle}
          {onSelect}
          {menuOpenKey}
          {onOpenMenu}
        />
      {/each}
    </ul>
  {/if}
</li>

<style>
  li {
    list-style: none;
  }

  ul[role="group"] {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tree-row-container {
    display: flex;
    align-items: center;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    transition: background-color var(--motion-duration) var(--motion-easing);
  }

  .tree-row-container:hover {
    background: var(--color-hover-accent);
  }

  .tree-row-container.selected {
    background: var(--color-selected-accent);
    box-shadow: inset 2px 0 0 var(--color-accent);
  }

  .tree-row-container.selected .tree-row-label {
    font-weight: var(--font-weight-medium);
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    min-height: var(--touch-target);
    padding-left: calc(var(--depth, 0) * var(--space-4) + var(--space-2));
    padding-right: var(--space-2);
    border: none;
    background: transparent;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    border-radius: 0;
  }

  .tree-row:focus-visible,
  .row-actions:focus-visible {
    outline-offset: -2px;
  }

  .sync-indicator {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    padding-right: var(--space-2);
  }

  .row-icon {
    flex-shrink: 0;
    color: var(--color-text-muted);
    transition: color var(--motion-duration) var(--motion-easing);
  }

  .share-glyph {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    margin-left: auto;
    fill: none;
    stroke: currentColor;
    color: var(--color-text-muted);
  }

  .chevron {
    transition: transform var(--motion-duration) var(--motion-easing);
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  /*
   * The saving sweep is a masked copy of the name laid over it, because a
   * gradient clipped to the text breaks the ellipsis. The permanent layer and
   * zero skew keep the glyphs from shifting when the slant starts or ends.
   */
  .tree-row-label {
    --sync-label-fade: 450ms;
    position: relative;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-sm);
    color: var(--color-text);
    transform: skewX(0deg);
    transform-origin: left bottom;
    will-change: transform;
    transition:
      color var(--sync-label-fade) ease,
      transform var(--sync-label-fade) ease;
  }

  .tree-row-label::after {
    content: attr(data-name) / "";
    position: absolute;
    inset: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
    opacity: 0;
    mask-image: linear-gradient(
      90deg,
      transparent 0% 35%,
      black 50%,
      transparent 65% 100%
    );
    mask-size: 300% 100%;
    mask-position: 100% 0;
    pointer-events: none;
    transition: opacity var(--sync-label-fade) ease;
  }

  /* A skew rather than font-style: italic, so the slant can transition. */
  .tree-row-label.unsynced {
    color: var(--color-text-muted);
    transform: skewX(-10deg);
  }

  .tree-row-label.saving::after {
    opacity: 1;
  }

  .tree-row-label.sweeping::after {
    animation: tree-row-saving 1.6s linear infinite;
  }

  @keyframes tree-row-saving {
    from {
      mask-position: 100% 0;
    }
    to {
      mask-position: 0% 0;
    }
  }

  .row-actions {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-target);
    height: var(--touch-target);
    margin-right: var(--space-1);
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

  .row-actions:hover {
    background: color-mix(in srgb, var(--color-text) 8%, transparent);
  }

  @media (pointer: fine) {
    .tree-row-container.selected .tree-row {
      cursor: default;
    }
  }

  @media (pointer: fine) and (min-width: 768px) {
    .row-actions {
      opacity: 0;
    }

    .tree-row-container:hover .row-actions,
    .tree-row-container:focus-within .row-actions,
    .row-actions.menu-open {
      opacity: 1;
    }
  }
</style>
