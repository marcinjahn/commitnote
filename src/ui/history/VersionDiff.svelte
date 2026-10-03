<script lang="ts">
  import { diffNote } from "../../history/line-diff";
  import type { VersionContent } from "../../history/note-history";
  import { describeSyncError } from "../browse/sync-messages";
  import {
    describeFinalNewline,
    describeFold,
    describeTitleChange,
    lineUnit,
    SAME_AS_CURRENT_MESSAGE,
    TITLE_ONLY_MESSAGE,
    TOO_LARGE_MESSAGE,
    UNDECRYPTABLE_VERSION_MESSAGE,
  } from "./history-messages";

  interface Props {
    /** Null while the version is being read. */
    content: VersionContent | null;
    /** Null when the note is no longer open. */
    current: string | null;
    currentName: string;
    forgeName: string;
    onRetry: () => void;
  }

  const { content, current, currentName, forgeName, onRetry }: Props =
    $props();

  const diff = $derived(
    content?.kind === "readable" && current !== null
      ? diffNote(current, content.content)
      : null,
  );
  const versionName = $derived(
    content !== null && content.kind !== "failed" ? content.name : null,
  );
  const titleChanged = $derived(
    versionName !== null && versionName !== currentName,
  );

  let unfolded = $state<ReadonlySet<number>>(new Set());

  function unfold(index: number): void {
    unfolded = new Set([...unfolded, index]);
  }
</script>

{#snippet sameLine(text: string)}
  <div class="diff-line same" data-testid="diff-line" data-kind="same">
    <span class="gutter" aria-hidden="true"></span>
    <span class="text">{text}</span>
  </div>
{/snippet}

<div class="version-diff" data-testid="version-diff">
  {#if content === null}
    <div class="skeleton" aria-hidden="true">
      <span class="skeleton-bar short"></span>
      {#each [0, 1, 2, 3, 4, 5] as i (i)}
        <span class="skeleton-bar" style="--i: {i}"></span>
      {/each}
    </div>
    <span class="visually-hidden" role="status">Loading version…</span>
  {:else if content.kind === "failed"}
    <div class="diff-message diff-error" role="alert">
      <span>{describeSyncError(content.error, forgeName)}</span>
      <button type="button" class="button" onclick={onRetry}>Retry</button>
    </div>
  {:else if content.kind === "undecryptable"}
    <p class="diff-message">{UNDECRYPTABLE_VERSION_MESSAGE}</p>
  {:else if current === null}
    <p class="diff-message">This note is no longer open.</p>
  {:else if diff?.kind === "tooLarge"}
    {#if titleChanged}
      <p class="title-change">{describeTitleChange(currentName, versionName!)}</p>
    {/if}
    <p class="diff-message">{TOO_LARGE_MESSAGE}</p>
  {:else if diff?.kind === "diff"}
    {@const unchanged =
      diff.added === 0 && diff.removed === 0 && diff.finalNewline === null}
    <div class="diff-summary">
      {#if unchanged && !titleChanged}
        <p class="diff-message" data-testid="diff-summary">{SAME_AS_CURRENT_MESSAGE}</p>
      {:else}
        {#if unchanged}
          <p class="counts" data-testid="diff-summary">{TITLE_ONLY_MESSAGE}</p>
        {:else}
          <p class="counts" data-testid="diff-summary">
            Restoring would change:
            <span class="count added">+{diff.added}</span>
            <span class="count removed">−{diff.removed}</span>
            {lineUnit(diff.added + diff.removed)}
          </p>
        {/if}
        {#if titleChanged}
          <p class="title-change" data-testid="diff-title">
            {describeTitleChange(currentName, versionName!)}
          </p>
        {/if}
        {#if diff.finalNewline !== null}
          <p class="title-change">{describeFinalNewline(diff.finalNewline)}</p>
        {/if}
      {/if}
    </div>
    {#if diff.items.length > 0}
      <div class="diff-lines">
        {#each diff.items as item, index (index)}
          {#if item.kind === "fold"}
            {#if unfolded.has(index)}
              <div class="unfolded">
                {#each item.lines as text, i (i)}
                  {@render sameLine(text)}
                {/each}
              </div>
            {:else}
              <button type="button" class="fold" onclick={() => unfold(index)}>
                <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />
                </svg>
                {describeFold(item.lines.length)}
              </button>
            {/if}
          {:else if item.line.kind === "same"}
            {@render sameLine(item.line.text)}
          {:else}
            <div
              class="diff-line {item.line.kind}"
              data-testid="diff-line"
              data-kind={item.line.kind}
            >
              <span class="gutter" aria-hidden="true"
                >{item.line.kind === "added" ? "+" : "−"}</span
              >
              <span class="visually-hidden"
                >{item.line.kind === "added" ? "Comes back: " : "Goes away: "}</span
              >
              <span class="text"
                >{#each item.line.segments as segment, i (i)}{#if segment.changed}<mark
                      class="word">{segment.text}</mark
                    >{:else}{segment.text}{/if}{/each}</span
              >
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .version-diff {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .diff-summary {
    display: grid;
    gap: var(--space-1);
  }

  .diff-summary p,
  .diff-message {
    margin: 0;
  }

  .counts {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    font-variant-numeric: tabular-nums;
  }

  .count {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }

  .count.added {
    color: var(--color-diff-added-text);
  }

  .count.removed {
    color: var(--color-diff-removed-text);
  }

  .title-change,
  .diff-message {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .diff-error {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
    color: var(--color-danger);
  }

  .diff-lines {
    border: var(--hairline) solid var(--color-border);
    font-size: var(--font-size-sm);
    line-height: var(--line-height);
  }

  .diff-line {
    display: flex;
    min-height: calc(1em * var(--line-height));
  }

  .gutter {
    flex-shrink: 0;
    width: 1.75rem;
    padding-left: var(--space-2);
    font-family: var(--font-mono);
    user-select: none;
  }

  .text {
    flex: 1;
    font-family: var(--font-note);
    min-width: 0;
    padding-right: var(--space-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .diff-line.same .text {
    color: var(--color-text-muted);
  }

  .diff-line.added {
    background: var(--color-diff-added);
  }

  .diff-line.added .gutter {
    color: var(--color-diff-added-text);
  }

  .word {
    color: inherit;
  }

  .diff-line.added .word {
    background: var(--color-diff-added-strong);
  }

  .diff-line.removed {
    background: var(--color-diff-removed);
  }

  .diff-line.removed .gutter {
    color: var(--color-diff-removed-text);
  }

  .diff-line.removed .word {
    background: var(--color-diff-removed-strong);
    text-decoration: line-through;
    text-decoration-color: color-mix(
      in srgb,
      var(--color-diff-removed-text) 50%,
      transparent
    );
  }

  .fold {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: 32px;
    padding: 0 var(--space-2) 0 calc(var(--space-2) - 2px);
    border: none;
    border-block: var(--hairline) solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-muted);
    font: inherit;
    font-size: var(--font-size-xs);
    text-align: left;
    cursor: pointer;
    transition:
      background-color var(--motion-duration) var(--motion-easing),
      color var(--motion-duration) var(--motion-easing);
  }

  .fold:first-child {
    border-top: none;
  }

  .fold:last-child {
    border-bottom: none;
  }

  .fold:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }

  .fold:focus-visible {
    outline-offset: -2px;
  }

  .unfolded {
    animation: unfold 200ms var(--motion-easing);
  }

  @keyframes unfold {
    from {
      opacity: 0;
    }
  }

  .skeleton {
    display: grid;
    gap: var(--space-2);
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
