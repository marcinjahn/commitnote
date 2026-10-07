<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import type { NoteDates } from "../../history/note-dates";
  import { systemClock } from "../../sync/clock";
  import { describeDateTime } from "../history/history-messages";
  import {
    NOT_SAVED_YET_LABEL,
    countTasks,
    countWords,
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

{#snippet stats()}
  {describeWordCount(wordCount)}{#if taskProgress.total > 0}<span aria-hidden="true"
      >{" · "}</span
    >{describeTaskProgress(taskProgress)}{/if}
{/snippet}

{#snippet sharedBadge()}
  {#if sharedShown}
    <span in:formFade out:formFade
      ><span aria-hidden="true">{" · "}</span><button
        type="button"
        class="details-shared"
        onclick={onShared}>Shared</button
      ></span
    >
  {/if}
{/snippet}

<p
  class="note-details"
  style:min-height={reserving && fullHeight > 0 ? `${fullHeight}px` : null}
  bind:borderBoxSize
>
  {#if form === "not-saved"}
    <span class="details-form" in:formFade out:formFade
      >{NOT_SAVED_YET_LABEL}<span aria-hidden="true">{" · "}</span>{@render stats()}{@render sharedBadge()}</span
    >
  {:else if form === "full" && fullDates !== null}
    <span class="details-form" in:formFade out:formFade
      ><span class="note-dates"
        ><time
          datetime={new Date(fullDates.created.at).toISOString()}
          title={describeDateTime(fullDates.created.at)}>{describeCreated(fullDates.created)}</time
        ><span aria-hidden="true">{" · "}</span><time
          datetime={new Date(fullDates.updated).toISOString()}
          data-settle={settling ? "" : undefined}
          title={describeDateTime(fullDates.updated)}>{describeUpdated(fullDates.updated, now)}</time
        ><span aria-hidden="true">{" · "}</span></span
      >{@render stats()}{@render sharedBadge()}</span
    >
  {:else if form === "compact"}
    <span class="details-form" in:formFade out:formFade
      >{@render stats()}{@render sharedBadge()}</span
    >
  {/if}
</p>

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
    font-size: var(--font-size-xs);
    line-height: var(--line-height);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .details-form {
    grid-area: 1 / 1;
  }

  .note-dates time {
    transition: color 600ms var(--motion-easing);
  }

  .note-dates time[data-settle] {
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

  .details-shared:hover {
    text-decoration: underline;
  }

  @media (pointer: coarse) {
    .details-shared {
      padding-block: var(--space-2);
      margin-block: calc(var(--space-2) * -1);
    }
  }
</style>
