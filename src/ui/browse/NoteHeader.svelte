<script lang="ts">
  import type { SyncState } from "../../sync/sync-state";
  import { describeSyncState } from "./sync-messages";
  import SyncStateIcon from "./SyncStateIcon.svelte";
  import { syncIndicatorFade } from "./sync-indicator-fade";
  import NameField from "../note/NameField.svelte";
  import { noteIcons } from "./action-icons";
  import { VERSION_HISTORY_LABEL } from "../history/history-messages";
  import MenuPopup from "./MenuPopup.svelte";
  import type { MenuAnchor } from "./row-menu-types";
  import { colorTagStyle, type ColorTag } from "../../tags/color-tag";
  import { describeColorTag } from "./tag-messages";

  interface Props {
    name: string;
    draft: boolean;
    syncState: SyncState | null;
    nameError: string | null;
    nameReadOnly: boolean;
    nameResetKey: number;
    namePendingText?: string | null;
    onNamePendingConsumed?: () => void;
    onNameCommit: (edited: string) => void;
    onNameEscape: () => void;
    onNameEnterDone: () => void;
    onNameInput?: (edited: string) => void;
    onBack: () => void;
    /** Shows the version history button. */
    onHistory?: () => void;
    historyDisabled?: boolean;
    colorTag?: ColorTag | null;
    colorTagDisabled?: boolean;
    shared?: boolean;
    /** Shows the share button. */
    onShare?: () => void;
    /** Shows the color tag button. */
    onColorTag?: (color: ColorTag | null) => void;
  }

  const {
    name,
    draft,
    syncState,
    nameError,
    nameReadOnly,
    nameResetKey,
    namePendingText = null,
    onNamePendingConsumed,
    onNameCommit,
    onNameEscape,
    onNameEnterDone,
    onNameInput,
    onBack,
    onHistory,
    historyDisabled = false,
    colorTag = null,
    colorTagDisabled = false,
    shared = false,
    onShare,
    onColorTag,
  }: Props = $props();

  const descId = $props.id();
  const sharedDescId = `${descId}-shared`;
  let tagButton: HTMLButtonElement | undefined = $state();
  let tagAnchor = $state<MenuAnchor | null>(null);

  function toggleTagMenu(): void {
    if (tagButton === undefined) return;
    tagAnchor =
      tagAnchor === null
        ? { kind: "rect", rect: tagButton.getBoundingClientRect() }
        : null;
  }

  function closeTagMenu(): void {
    tagAnchor = null;
    tagButton?.focus();
  }

  function pickColorTag(color: ColorTag | null): void {
    closeTagMenu();
    onColorTag?.(color);
  }
</script>

<header class="note-header">
  <button
    type="button"
    class="button button-ghost button-icon back-button"
    aria-label="Back to notes"
    onclick={onBack}
  >
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M10 3L5 8l5 5" />
    </svg>
  </button>
  <NameField
    value={name}
    readOnly={nameReadOnly}
    error={nameError}
    resetKey={nameResetKey}
    autofocus={draft}
    pendingText={namePendingText}
    onPendingConsumed={onNamePendingConsumed}
    onCommit={onNameCommit}
    onEscape={onNameEscape}
    onEnterDone={onNameEnterDone}
    onInput={onNameInput}
  />
  {#if !draft && syncState !== null && syncState.kind !== "synced"}
    <span
      class="sync-status"
      in:syncIndicatorFade={{ duration: 200 }}
      out:syncIndicatorFade={{ duration: 400 }}
    >
      <SyncStateIcon state={syncState} />
      <span class="sync-status-label">{describeSyncState(syncState)}</span>
    </span>
  {/if}
  {#if !draft && onShare !== undefined}
    <button
      type="button"
      class={["button button-ghost button-icon share-button", shared && "is-shared"]}
      aria-label="Share"
      title="Share"
      aria-describedby={shared ? sharedDescId : undefined}
      onclick={onShare}
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {#each noteIcons.share as d (d)}
          <path {d} />
        {/each}
      </svg>
    </button>
    {#if shared}
      <span id={sharedDescId} class="visually-hidden">Shared</span>
    {/if}
  {/if}
  {#if !draft && onColorTag !== undefined}
    <button
      type="button"
      class="button button-ghost button-icon color-tag-button"
      bind:this={tagButton}
      aria-label="Color tag"
      title="Color tag"
      aria-haspopup="menu"
      aria-expanded={tagAnchor !== null}
      aria-describedby={descId}
      disabled={colorTagDisabled}
      onclick={toggleTagMenu}
    >
      <svg
        class={["icon", colorTag !== null && "tag-colored"]}
        class:tagged={colorTag !== null}
        style={colorTag === null ? undefined : colorTagStyle(colorTag)}
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        {#each noteIcons.tag as d (d)}
          <path {d} />
        {/each}
      </svg>
    </button>
    <span id={descId} class="visually-hidden">
      {colorTag === null ? "No color" : describeColorTag(colorTag)}
    </span>
    {#if tagAnchor !== null && tagButton !== undefined}
      <MenuPopup
        label="Color tag"
        items={[]}
        anchor={tagAnchor}
        trigger={tagButton}
        swatches={{ selected: colorTag, disabled: false, onPick: pickColorTag }}
        onSelect={() => {}}
        onClose={closeTagMenu}
      />
    {/if}
  {/if}
  {#if !draft && onHistory !== undefined}
    <button
      type="button"
      class="button button-ghost button-icon history-button"
      aria-label={VERSION_HISTORY_LABEL}
      title={VERSION_HISTORY_LABEL}
      disabled={historyDisabled}
      onclick={onHistory}
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {#each noteIcons.history as d (d)}
          <path {d} />
        {/each}
      </svg>
    </button>
  {/if}
</header>

<style>
  .note-header {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: calc(var(--touch-target) + var(--space-2) * 2);
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-1);
    border-bottom: var(--hairline) solid var(--color-border);
    background: var(--color-background);
  }

  .back-button {
    flex-shrink: 0;
  }

  .back-button .icon {
    width: 22px;
    height: 22px;
    stroke-width: 1.75;
  }

  .note-header :global(.name-input) {
    font-size: 1.0625rem;
  }

  .history-button,
  .share-button,
  .color-tag-button {
    flex-shrink: 0;
    color: var(--color-text-muted);
  }

  .color-tag-button .icon {
    transition:
      color var(--motion-duration) var(--motion-easing),
      fill var(--motion-duration) var(--motion-easing);
  }

  .color-tag-button .icon.tagged {
    stroke: var(--tag-color);
  }

  .color-tag-button .icon.tagged :global(path:first-child) {
    fill: color-mix(in srgb, var(--tag-color) 20%, transparent);
  }

  .share-button.is-shared,
  .share-button.is-shared:hover:not(:disabled) {
    color: var(--color-accent);
  }

  .history-button:hover:not(:disabled),
  .share-button:hover:not(:disabled),
  .color-tag-button:hover:not(:disabled) {
    color: var(--color-text);
  }

  .sync-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
  }

  .sync-status-label {
    display: none;
  }

  @media (min-width: 768px) {
    .note-header {
      gap: var(--space-2);
      padding-left: var(--space-3);
    }

    .back-button {
      display: none;
    }

    .note-header :global(.name-input) {
      font-size: var(--font-size-lg);
    }

    .sync-status-label {
      display: inline;
    }
  }
</style>
