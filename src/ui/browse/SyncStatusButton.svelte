<script lang="ts">
  import type { NotePath } from "../../changes/change";
  import type { SyncState } from "../../sync/sync-state";
  import MenuPopup from "./MenuPopup.svelte";
  import SyncStateIcon from "./SyncStateIcon.svelte";
  import type { MenuAnchor } from "./row-menu-types";
  import { syncIndicatorFade } from "./sync-indicator-fade";
  import { getStandalone } from "../standalone-context";
  import { describeSyncStatus } from "./sync-messages";
  import { buildSyncStatusMenu } from "./sync-status-menu";

  interface Props {
    state: SyncState;
    offline: boolean;
    hasUnsaved: boolean;
    notes: readonly NotePath[];
    others: number;
    canRetry: boolean;
    onOpenNote: (path: NotePath) => void;
    onRetry: () => void;
  }

  const { state: syncState, offline, hasUnsaved, notes, others, canRetry, onOpenNote, onRetry }: Props =
    $props();

  const standalone = getStandalone();

  let button: HTMLButtonElement | undefined = $state();
  let anchor = $state<MenuAnchor | null>(null);

  const visible = $derived(offline || syncState.kind === "out-of-sync");
  const label = $derived(describeSyncStatus({ state: syncState, offline, hasUnsaved, standalone }));
  const failed = $derived(
    !offline && syncState.kind === "out-of-sync" && syncState.reason === "failed",
  );
  const statusKind = $derived(
    offline ? "offline" : syncState.kind === "out-of-sync" ? syncState.reason : undefined,
  );
  const menu = $derived(buildSyncStatusMenu({ notes, others, canRetry }));

  $effect(() => {
    if (!visible) anchor = null;
  });

  function toggle(): void {
    if (button === undefined) return;
    anchor =
      anchor === null ? { kind: "rect", rect: button.getBoundingClientRect() } : null;
  }

  function close(): void {
    anchor = null;
    button?.focus();
  }

  function handleSelect(id: string): void {
    const path = menu.pathOf(id);
    close();
    if (id === "retry") onRetry();
    else if (path !== null) onOpenNote(path);
  }
</script>

{#if visible}
  <button
    type="button"
    class="button button-icon button-ghost sync-status-button"
    class:failed
    bind:this={button}
    aria-label={label}
    title={label}
    aria-haspopup="menu"
    aria-expanded={anchor !== null}
    data-sync-status={statusKind}
    onclick={toggle}
    in:syncIndicatorFade={{ duration: 200 }}
    out:syncIndicatorFade={{ duration: 400 }}
  >
    <span class="indicator-icon" aria-hidden="true">
      {#if offline}
        <svg class="icon offline" viewBox="0 0 16 16" focusable="false">
          <path
            d="M4.5 12.5h6.25a2.5 2.5 0 0 0 .5-4.95A3.75 3.75 0 0 0 4.4 6.6 2.95 2.95 0 0 0 4.5 12.5z"
          />
          <path d="M2 2l12 12" />
        </svg>
      {:else}
        <SyncStateIcon state={syncState} {label} />
      {/if}
    </span>
  </button>
{/if}

{#if anchor !== null && button !== undefined}
  <MenuPopup
    label="Unsaved notes"
    items={menu.items}
    {anchor}
    trigger={button}
    onSelect={handleSelect}
    onClose={close}
  />
{/if}

<style>
  .sync-status-button {
    flex-shrink: 0;
    color: var(--color-text-muted);
  }

  @media (hover: hover) {
    .sync-status-button:hover {
      color: var(--color-text);
    }
  }

  .sync-status-button.failed {
    color: var(--color-danger);
  }

  .indicator-icon {
    display: inline-flex;
  }
</style>
