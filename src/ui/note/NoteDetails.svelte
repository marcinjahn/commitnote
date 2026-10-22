<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import type { NoteDates } from "../../history/note-dates";
  import { systemClock } from "../../sync/clock";
  import { countTasks, countWords } from "../../tree/note-stats";
  import { describeDateTime } from "../history/history-messages";
  import {
    NOT_SAVED_YET_LABEL,
    type DetailItemText,
    describeCreated,
    describeUpdated,
    describeTaskProgress,
    describeWordCount,
  } from "../history/note-details-messages";
  import { createDatesGrace, type DetailsForm } from "./dates-grace";
  import { detailsFade } from "./details-fade";
  import { createUpdatedSettle } from "./updated-settle";

  interface Props {
    text: string;
    dates: NoteDates | null;
    notSaved: boolean;
    noteSwitch: number;
    shared?: boolean;
    onShared?: () => void;
  }

  const { text, dates, notSaved, noteSwitch, shared = false, onShared }: Props = $props();

  const WORD_COUNT_DEBOUNCE_MS = 300;
  const NOW_REFRESH_MS = 60_000;

  let wordCount = $state(untrack(() => countWords(text)));
  let taskProgress = $state(untrack(() => countTasks(text)));
  let countedSwitch = untrack(() => noteSwitch);
  $effect.pre(() => {
    const current = text;
    if (noteSwitch !== countedSwitch) {
      countedSwitch = noteSwitch;
      wordCount = countWords(current);
      taskProgress = countTasks(current);
      return;
    }
    const timer = setTimeout(() => {
      wordCount = countWords(current);
      taskProgress = countTasks(current);
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

  let form = $state<DetailsForm>("pending");
  let fullDates = $state<NoteDates | null>(untrack(() => dates));
  let sharedShown = $state(false);
  let reserving = $state(false);
  let borderBoxSize = $state<ReadonlyArray<ResizeObserverSize>>();
  const measuredHeight = $derived(borderBoxSize?.[0]?.blockSize ?? 0);
  let fullHeight = $state(0);

  // Form changes that arrive with a note switch are part of the content's
  // switch motion, so they appear without a cross-fade of their own.
  let instant = true;
  let updating = false;
  let seenSwitch: number | null = null;

  const grace = createDatesGrace({
    clock: systemClock,
    onForm: (next) => {
      if (!updating) instant = false;
      form = next;
    },
  });
  onDestroy(() => grace.dispose());

  let settling = $state(false);
  const updatedSettle = createUpdatedSettle({
    clock: systemClock,
    onSettle: (next) => {
      settling = next;
    },
  });
  onDestroy(() => updatedSettle.dispose());

  $effect.pre(() => {
    const input = { noteSwitch, notSaved, hasDates: dates !== null };
    const latestDates = dates;
    const latestShared = shared && onShared !== undefined;
    untrack(() => {
      const switched = seenSwitch !== null && input.noteSwitch !== seenSwitch;
      seenSwitch = input.noteSwitch;
      instant = switched;
      if (latestDates !== null) fullDates = latestDates;
      sharedShown = latestShared;
      updating = true;
      grace.update(input);
      updating = false;
      updatedSettle.update({
        noteSwitch: input.noteSwitch,
        updated: latestDates?.updated ?? null,
      });
      if (switched) reserving = form !== "full";
      else if (form === "full") reserving = false;
    });
  });

  $effect(() => {
    if (form === "full" && !reserving) fullHeight = measuredHeight;
  });

  function formFade(node: Element) {
    return detailsFade(node, instant);
  }
</script>

{#snippet countItem(text: DetailItemText)}
  <span class="detail-item" role="listitem"
    ><span class="detail-value">{text.value}</span>{" "}<span class="detail-label">{text.label}</span></span
  >
{/snippet}

{#snippet dateItem(text: DetailItemText)}
  <span class="detail-label">{text.label}</span>{" "}<span class="detail-value">{text.value}</span>
{/snippet}

{#snippet statsGroup()}
  <div class="details-group" role="presentation"
    >{@render countItem(describeWordCount(wordCount))}{#if taskProgress.total > 0}{" "}{@render countItem(
        describeTaskProgress(taskProgress),
      )}{/if}{#if sharedShown}{" "}<span class="detail-item" role="listitem" in:formFade out:formFade
        ><button type="button" class="details-shared" onclick={onShared}>Shared</button></span
      >{/if}</div
  >
{/snippet}

<div
  class="note-details"
  style:min-height={reserving && fullHeight > 0 ? `${fullHeight}px` : null}
  bind:borderBoxSize
>
  {#if form === "not-saved"}
    <div class="details-form" role="list" aria-label="Note details" in:formFade out:formFade
      ><div class="details-group" role="presentation"
        ><span class="detail-item" role="listitem">{NOT_SAVED_YET_LABEL}</span></div
      >{" "}{@render statsGroup()}</div
    >
  {:else if form === "full" && fullDates !== null}
    <div class="details-form" role="list" aria-label="Note details" in:formFade out:formFade
      ><div class="details-group note-dates" role="presentation"
        ><time
          class="detail-item"
          role="listitem"
          datetime={new Date(fullDates.created.at).toISOString()}
          title={describeDateTime(fullDates.created.at)}>{@render dateItem(describeCreated(fullDates.created))}</time
        >{" "}<time
          class="detail-item"
          role="listitem"
          datetime={new Date(fullDates.updated).toISOString()}
          data-settle={settling ? "" : undefined}
          title={describeDateTime(fullDates.updated)}>{@render dateItem(describeUpdated(fullDates.updated, now))}</time
        ></div
      >{" "}{@render statsGroup()}</div
    >
  {:else if form === "compact"}
    <div class="details-form" role="list" aria-label="Note details" in:formFade out:formFade
      >{@render statsGroup()}</div
    >
  {/if}
</div>

<style>
  .note-details {
    box-sizing: border-box;
    display: grid;
    grid-template-rows: minmax(1lh, auto);
    width: 100%;
    max-width: var(--content-max-width);
    margin: 0 auto;
    padding: var(--space-4) var(--space-4) 0 calc(var(--space-4) + 6px);
    flex: none;
    font-size: var(--font-size-sm);
    line-height: var(--line-height);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .details-form {
    grid-area: 1 / 1;
    display: flex;
    flex-wrap: wrap;
    column-gap: calc(var(--space-3) * 2 + 1px);
    row-gap: var(--space-1);
    /* Hides the divider of a group that wrapped to the start of a line. */
    clip-path: inset(-1lh -1lh -1lh calc(var(--space-2) * -1));
  }

  .details-group {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--space-3);
    row-gap: var(--space-1);
  }

  .detail-item {
    white-space: nowrap;
  }

  .details-group + .details-group::before {
    content: "";
    position: absolute;
    top: 50%;
    left: calc((var(--space-3) + 1px) * -1);
    height: 0.9em;
    border-inline-start: 1px solid var(--color-border-strong);
    translate: 0 -50%;
  }

  .detail-value {
    color: var(--color-text);
  }

  .note-dates .detail-value {
    transition: color 600ms var(--motion-easing);
  }

  .note-dates time[data-settle] .detail-value {
    color: var(--color-link);
    transition: none;
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

  @media (hover: hover) {
    .details-shared:hover {
      text-decoration: underline;
    }
  }

  @media (pointer: coarse) {
    .details-shared {
      padding-block: var(--space-2);
      margin-block: calc(var(--space-2) * -1);
    }
  }
</style>
