<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import type { NotePath } from "../../changes/change";
  import type { ContentIndexer, IndexerState } from "../../search/content-indexer";
  import {
    matchContents,
    matchNames,
    type ContentMatch,
    type MatchSection,
    type NameMatch,
  } from "../../search/search-ranking";
  import { parseTerms, toSegments, type TextRange } from "../../search/search-text";
  import { CONTENT_QUERY_DEBOUNCE_MS, RESULT_CAP } from "../../search/search-tuning";
  import type { SearchSource } from "../../sync/search-source";
  import NoteIcon from "../browse/NoteIcon.svelte";
  import { describeColorTag } from "../browse/tag-messages";
  import Dialog from "../dialogs/Dialog.svelte";
  import {
    contentSectionHeading,
    describeNoMatches,
    describeResultCount,
    describeSearchStatus,
    describeShowingFirst,
    NAME_SECTION_HEADING,
    RECENT_SECTION_HEADING,
    SEARCH_HINT,
    SEARCH_PLACEHOLDER,
    STILL_READING,
  } from "./search-messages";
  import { keepActive, moveActive } from "./search-navigation";

  interface Props {
    indexer: ContentIndexer;
    forgeName: string;
    recent: readonly NotePath[];
    onOpen: (path: NotePath) => void;
    onClose: () => void;
  }

  const { indexer, forgeName, recent, onOpen, onClose }: Props = $props();

  const PAUSED_REFRESH_MS = 15_000;
  const EMPTY_CONTENTS: MatchSection<ContentMatch> = { matches: [], more: false };

  const uid = $props.id();
  const listboxId = `search-results-${uid}`;
  const recentHeadingId = `search-recent-${uid}`;
  const nameHeadingId = `search-names-${uid}`;
  const contentHeadingId = `search-contents-${uid}`;
  const optionId = (index: number) => `search-option-${uid}-${index}`;

  let indexerState: IndexerState = $state.raw(untrack(() => indexer.getState()));
  let sources: readonly SearchSource[] = $state.raw(untrack(() => indexer.sources()));
  let version = $state(0);
  let now = $state(Date.now());
  let query = $state("");

  const terms = $derived(parseTerms(query));
  const nameSection = $derived(matchNames(sources, terms));
  let contentSection = $state.raw(EMPTY_CONTENTS);
  let contentTerms: readonly string[] = $state.raw([]);

  let contentSeq = 0;
  let contentTimer: ReturnType<typeof setTimeout> | undefined;

  function runContent(): void {
    const current = terms;
    contentTerms = current;
    contentSection =
      current.length === 0
        ? EMPTY_CONTENTS
        : matchContents(indexer.sources(), current, (source) => indexer.contentFor(source));
  }

  function cancelContent(): void {
    if (contentTimer !== undefined) clearTimeout(contentTimer);
    contentTimer = undefined;
  }

  // An indexer notification only schedules a run when none is pending, so a steady
  // stream of index updates cannot postpone the content results indefinitely.
  function scheduleContent(restart: boolean): void {
    if (contentTimer !== undefined) {
      if (!restart) return;
      cancelContent();
    }
    const seq = ++contentSeq;
    contentTimer = setTimeout(() => {
      contentTimer = undefined;
      if (seq === contentSeq) runContent();
    }, CONTENT_QUERY_DEBOUNCE_MS);
  }

  let scheduledTerms: readonly string[] | null = null;

  $effect(() => {
    const current = terms;
    void version;
    untrack(() => {
      const queryChanged = current !== scheduledTerms;
      scheduledTerms = current;
      if (current.length === 0) {
        cancelContent();
        contentSeq++;
        runContent();
      } else {
        scheduleContent(queryChanged);
      }
    });
  });

  onMount(() => {
    indexer.open();
    const unsubscribe = indexer.subscribe(() => {
      indexerState = indexer.getState();
      sources = indexer.sources();
      version++;
    });
    indexerState = indexer.getState();
    sources = indexer.sources();
    return () => {
      unsubscribe();
      cancelContent();
      indexer.close();
    };
  });

  $effect(() => {
    if (indexerState.status.kind !== "paused") return;
    now = Date.now();
    const interval = setInterval(() => (now = Date.now()), PAUSED_REFRESH_MS);
    return () => clearInterval(interval);
  });

  const statusText = $derived(describeSearchStatus(indexerState, forgeName, now));
  const progress = $derived(
    indexerState.status.kind === "indexing" && indexerState.status.total > 0
      ? indexerState.status.done / indexerState.status.total
      : null,
  );
  const partial = $derived(indexerState.status.kind !== "complete");

  interface Row {
    readonly key: string;
    readonly match: NameMatch | ContentMatch;
  }

  const toRow = (match: NameMatch | ContentMatch): Row => ({
    key: JSON.stringify(match.source.path),
    match,
  });
  const nameRows = $derived(nameSection.matches.map(toRow));
  const contentRows = $derived(contentSection.matches.map(toRow));
  const recentRows = $derived.by(() => {
    if (terms.length > 0) return [];
    const byKey = new Map(sources.map((source) => [JSON.stringify(source.path), source]));
    return recent.flatMap((path) => {
      const source = byKey.get(JSON.stringify(path));
      return source === undefined
        ? []
        : [toRow({ source, nameRanges: [], folderRanges: [] })];
    });
  });
  const rows = $derived(
    terms.length === 0 ? recentRows : [...nameRows, ...contentRows],
  );
  const showContentSection = $derived(
    contentRows.length > 0 || (nameRows.length > 0 && partial),
  );
  const contentsSettled = $derived(contentTerms === terms);
  const resultCountText = $derived(
    terms.length === 0 || !contentsSettled
      ? ""
      : describeResultCount(rows.length),
  );

  let active = $state(-1);
  let activeKey: string | null = null;

  $effect.pre(() => {
    const keys = rows.map((row) => row.key);
    const index = keepActive(activeKey, keys);
    active = index;
    activeKey = keys[index] ?? null;
  });

  function setActive(index: number): void {
    active = index;
    activeKey = rows[index]?.key ?? null;
  }

  async function revealActive(): Promise<void> {
    await tick();
    if (active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(moveActive(active, rows.length, event.key === "ArrowDown" ? 1 : -1));
      void revealActive();
    } else if (event.key === "Enter") {
      const row = rows[active];
      if (row === undefined) return;
      event.preventDefault();
      onOpen(row.match.source.path);
    }
  }

  function folders(match: NameMatch): { text: string; ranges: readonly TextRange[] }[] {
    return match.source.path
      .slice(0, -1)
      .map((text, i) => ({ text, ranges: match.folderRanges[i] ?? [] }));
  }
</script>

{#snippet highlighted(text: string, ranges: readonly TextRange[])}{#each toSegments(text, ranges) as segment, i (i)}{#if segment.match}<mark>{segment.text}</mark>{:else}{segment.text}{/if}{/each}{/snippet}

{#snippet option(row: Row, index: number)}
  {@const match = row.match}
  {@const source = match.source}
  {@const folderParts = folders(match)}
  <div
    id={optionId(index)}
    class="option"
    class:active={index === active}
    role="option"
    tabindex="-1"
    aria-selected={index === active}
    onpointermove={() => {
      if (index !== active) setActive(index);
    }}
    onmousedown={(event) => event.preventDefault()}
    onclick={() => onOpen(source.path)}
    onkeydown={handleKeydown}
  >
    <div class="option-line">
      <NoteIcon colorTag={source.colorTag} muted />
      <span class="option-name">{@render highlighted(source.name, match.nameRanges)}</span>
      {#if source.colorTag !== null}
        <span class="visually-hidden">{describeColorTag(source.colorTag)}</span>
      {/if}
      {#if folderParts.length > 0}
        <span class="option-folder"
          >{#each folderParts as part, i (i)}{#if i > 0}{" / "}{/if}{@render highlighted(
              part.text,
              part.ranges,
            )}{/each}</span
        >
      {/if}
    </div>
    {#if "snippet" in match}
      <div class="option-snippet">{@render highlighted(match.snippet.text, match.snippet.ranges)}</div>
    {/if}
  </div>
{/snippet}

<Dialog open={true} top title="Search notes" closeButton {onClose}>
  <div class="search-head">
    <div class="search-input-row">
      <svg class="icon search-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5l3.5 3.5" />
      </svg>
      <input
        class="search-input"
        type="text"
        role="combobox"
        aria-label="Search notes"
        aria-autocomplete="list"
        aria-expanded={rows.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        placeholder={SEARCH_PLACEHOLDER}
        autocomplete="off"
        spellcheck="false"
        enterkeyhint="go"
        bind:value={query}
        onkeydown={handleKeydown}
      />
    </div>
    <div class="search-status" aria-live="polite">
      {#if statusText !== null}
        <p class="search-status-text">{statusText}</p>
      {/if}
      {#if progress !== null}
        <div class="search-progress" aria-hidden="true">
          <div class="search-progress-fill" style:width="{progress * 100}%"></div>
        </div>
      {/if}
    </div>
  </div>

  <p class="visually-hidden" role="status">{resultCountText}</p>

  <div class="search-results">
    {#if terms.length === 0}
      {#if recentRows.length === 0}
        <p class="search-message">{SEARCH_HINT}</p>
      {/if}
    {:else if rows.length === 0 && contentsSettled}
      <p class="search-message">
        {describeNoMatches(query)}
        {#if partial}
          <br />{STILL_READING}
        {/if}
      </p>
    {/if}
    <div role="listbox" id={listboxId} aria-label="Search results" class="listbox">
      {#if recentRows.length > 0}
        <div role="group" aria-labelledby={recentHeadingId} class="section">
          <div id={recentHeadingId} class="section-heading">{RECENT_SECTION_HEADING}</div>
          {#each recentRows as row, i (row.key)}
            {@render option(row, i)}
          {/each}
        </div>
      {/if}
      {#if terms.length > 0 && nameRows.length > 0}
        <div role="group" aria-labelledby={nameHeadingId} class="section">
          <div id={nameHeadingId} class="section-heading">{NAME_SECTION_HEADING}</div>
          {#each nameRows as row, i (row.key)}
            {@render option(row, i)}
          {/each}
          {#if nameSection.more}
            <div class="section-more">{describeShowingFirst(RESULT_CAP)}</div>
          {/if}
        </div>
      {/if}
      {#if showContentSection}
        <div role="group" aria-labelledby={contentHeadingId} class="section">
          <div id={contentHeadingId} class="section-heading">
            {contentSectionHeading(partial)}
          </div>
          {#each contentRows as row, i (row.key)}
            {@render option(row, nameRows.length + i)}
          {/each}
          {#if contentSection.more}
            <div class="section-more">{describeShowingFirst(RESULT_CAP)}</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</Dialog>

<style>
  .search-head {
    flex-shrink: 0;
    border-bottom: var(--hairline) solid var(--color-border);
    transition: border-color var(--motion-duration) var(--motion-easing);
  }

  .search-head:focus-within {
    border-bottom-color: var(--color-accent-hairline);
  }

  .search-input-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-inline: var(--space-3);
  }

  .search-icon {
    color: var(--color-text-muted);
  }

  .search-input {
    flex: 1;
    min-width: 0;
    min-height: 52px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-size: var(--font-size-base);
  }

  .search-input:focus,
  .search-input:focus-visible {
    outline: none;
  }

  .search-input::placeholder {
    color: var(--color-text-muted);
  }

  .search-status:empty {
    display: none;
  }

  .search-status-text {
    margin: 0;
    padding: 0 var(--space-3) var(--space-2);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .search-progress {
    height: 2px;
    background: var(--color-border);
  }

  .search-progress-fill {
    height: 100%;
    background: var(--color-accent);
    transition: width var(--motion-duration) var(--motion-easing);
  }

  .search-results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .search-message {
    margin: 0;
    padding: var(--space-3);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .listbox:empty {
    display: none;
  }

  .section {
    padding-block: var(--space-1);
  }

  .section + .section {
    border-top: var(--hairline) solid var(--color-border);
  }

  .section-heading,
  .section-more {
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .section-heading {
    font-weight: var(--font-weight-medium);
  }

  .option {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
    transition: background-color var(--motion-duration) var(--motion-easing);
  }

  .option.active {
    background: var(--color-hover);
    box-shadow: inset 2px 0 0 var(--color-accent);
  }

  .option-line {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .option-line :global(.note-icon) {
    align-self: center;
  }

  .option-name {
    flex-shrink: 0;
    max-width: 70%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .option-folder,
  .option-snippet {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
  }

  .option-folder {
    font-size: var(--font-size-xs);
  }

  .option-snippet {
    padding-inline-start: calc(var(--icon-size) + var(--space-2));
    font-size: var(--font-size-sm);
  }

  mark {
    background: color-mix(in srgb, var(--color-accent) 30%, transparent);
    color: inherit;
    border-radius: 0;
  }

  @media (pointer: coarse) {
    .option {
      min-height: var(--touch-target);
    }
  }
</style>
