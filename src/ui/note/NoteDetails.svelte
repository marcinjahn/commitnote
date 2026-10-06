<script lang="ts">
  import { untrack } from "svelte";
  import type { NoteDates } from "../../history/note-dates";
  import { describeDateTime } from "../history/history-messages";
  import {
    NOT_SAVED_YET_LABEL,
    countWords,
    describeCreated,
    describeUpdated,
    describeWordCount,
  } from "../history/note-details-messages";

  interface Props {
    text: string;
    dates: NoteDates | null;
    notSaved: boolean;
    shared?: boolean;
    onShared?: () => void;
  }

  const { text, dates, notSaved, shared = false, onShared }: Props = $props();

  const WORD_COUNT_DEBOUNCE_MS = 300;
  const NOW_REFRESH_MS = 60_000;

  let wordCount = $state(untrack(() => countWords(text)));
  $effect(() => {
    const current = text;
    const timer = setTimeout(() => {
      wordCount = countWords(current);
    }, WORD_COUNT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, NOW_REFRESH_MS);
    return () => clearInterval(timer);
  });
</script>

<p class="note-details">
  {#if notSaved}
    {NOT_SAVED_YET_LABEL}<span aria-hidden="true">{" · "}</span>{describeWordCount(wordCount)}
  {:else if dates !== null}
    <span class="note-dates"
      ><time
        datetime={new Date(dates.created.at).toISOString()}
        title={describeDateTime(dates.created.at)}>{describeCreated(dates.created)}</time
      ><span aria-hidden="true">{" · "}</span><time
        datetime={new Date(dates.updated).toISOString()}
        title={describeDateTime(dates.updated)}>{describeUpdated(dates.updated, now)}</time
      ><span aria-hidden="true">{" · "}</span></span
    >{describeWordCount(wordCount)}
  {:else}
    {describeWordCount(wordCount)}
  {/if}
  {#if shared && onShared}
    <span aria-hidden="true">{" · "}</span><button
      type="button"
      class="details-shared"
      onclick={onShared}>Shared</button
    >
  {/if}
</p>

<style>
  .note-details {
    box-sizing: border-box;
    width: 100%;
    max-width: var(--content-max-width);
    margin: 0 auto;
    padding: var(--space-4) var(--space-4) 0 calc(var(--space-4) + 6px);
    flex: none;
    font-size: var(--font-size-xs);
    line-height: var(--line-height);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .details-shared {
    display: inline;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .details-shared:hover {
    text-decoration: underline;
  }

  @media (pointer: coarse) {
    .details-shared {
      padding-block: var(--space-2);
      margin-block: calc(var(--space-2) * -1);
    }
  }

  .note-dates {
    animation: note-dates-fade-in var(--motion-duration) var(--motion-easing);
  }

  @keyframes note-dates-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
