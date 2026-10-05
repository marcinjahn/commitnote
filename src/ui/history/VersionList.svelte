<script lang="ts">
  import { groupVersions } from "../../history/group-versions";
  import type {
    HistoryEnd,
    NoteVersion,
  } from "../../history/note-history";
  import type { SyncError } from "../../sync/sync-engine";
  import { describeSyncError } from "../browse/sync-messages";
  import {
    dayKey,
    describeDateTime,
    describeDay,
    describeEvent,
    describeHistoryEnd,
    describeSession,
    describeTime,
    LOAD_OLDER_LABEL,
  } from "./history-messages";

  interface Props {
    versions: readonly NoteVersion[];
    end: HistoryEnd | null;
    loading: boolean;
    error: SyncError | null;
    forgeName: string;
    currentName: string;
    selectedSha: string | null;
    now: number;
    onSelect: (version: NoteVersion, via: "pointer" | "keyboard") => void;
    onLoadMore: () => void;
    onRetry: () => void;
  }

  const {
    versions,
    end,
    loading,
    error,
    forgeName,
    currentName,
    selectedSha,
    now,
    onSelect,
    onLoadMore,
    onRetry,
  }: Props = $props();

  type Row =
    | { readonly kind: "single"; readonly version: NoteVersion; readonly current: boolean }
    | { readonly kind: "session"; readonly versions: readonly NoteVersion[] };

  interface Section {
    readonly day: number;
    readonly rows: Row[];
  }

  const sections = $derived.by(() => {
    const [current, ...older] = versions;
    if (current === undefined) return [];
    const rows: Row[] = [{ kind: "single", version: current, current: true }];
    for (const group of groupVersions(older)) {
      rows.push(
        group.versions.length === 1
          ? { kind: "single", version: group.versions[0]!, current: false }
          : { kind: "session", versions: group.versions },
      );
    }
    const result: Section[] = [];
    for (const row of rows) {
      const day = dayKey(newestOf(row).committedAt);
      const last = result[result.length - 1];
      if (last !== undefined && last.day === day) last.rows.push(row);
      else result.push({ day, rows: [row] });
    }
    return result;
  });

  const indexBySha = $derived(
    new Map(versions.map((version, index) => [version.sha, index])),
  );

  let expanded = $state<ReadonlySet<string>>(new Set());
  let listEl: HTMLElement | undefined = $state();

  function newestOf(row: Row): NoteVersion {
    return row.kind === "single" ? row.version : row.versions[0]!;
  }

  function toggle(sha: string): void {
    const next = new Set(expanded);
    if (!next.delete(sha)) next.add(sha);
    expanded = next;
  }

  function labelsOf(version: NoteVersion): string[] {
    const index = indexBySha.get(version.sha);
    const previous =
      index === undefined ? undefined : versions[index + 1];
    return version.events.map((event) =>
      describeEvent(event, previous?.name ?? null),
    );
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [
      ...(listEl?.querySelectorAll<HTMLButtonElement>("[data-version-sha]") ??
        []),
    ];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[at + (event.key === "ArrowDown" ? 1 : -1)];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
    next.scrollIntoView({ block: "nearest" });
    const version = versions[indexBySha.get(next.dataset.versionSha!) ?? -1];
    if (version !== undefined) onSelect(version, "keyboard");
  }

  function loadWhenVisible(node: HTMLElement) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
</script>

{#snippet versionButton(version: NoteVersion, text: string, current: boolean, sub: boolean)}
  {@const labels = labelsOf(version)}
  <button
    type="button"
    class="version-row"
    class:selected={selectedSha === version.sha}
    class:sub
    aria-current={selectedSha === version.sha ? "true" : undefined}
    data-version-sha={version.sha}
    data-testid="version-row"
    onclick={() => onSelect(version, "pointer")}
  >
    <span class="version-line">
      <time
        datetime={new Date(version.committedAt).toISOString()}
        title={describeDateTime(version.committedAt)}
      >{text}</time>
      {#if current}<span class="current-badge">Current</span>{/if}
    </span>
    {#if labels.length > 0 || (version.name !== null && version.name !== currentName)}
      <span class="version-meta">
        {#if labels.length > 0}<span class="version-labels">{labels.join(" · ")}</span>{/if}
        {#if version.name !== null && version.name !== currentName}
          <span class="version-name">{version.name}</span>
        {/if}
      </span>
    {/if}
  </button>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="version-list"
  data-testid="version-list"
  bind:this={listEl}
  onkeydown={handleKeydown}
>
  {#each sections as section (newestOf(section.rows[0]!).sha)}
    <section class="day">
      <h3 class="day-header">{describeDay(section.day, now)}</h3>
      <ul class="rows">
        {#each section.rows as row (newestOf(row).sha)}
          <li>
            {#if row.kind === "single"}
              {@render versionButton(
                row.version,
                describeTime(row.version.committedAt),
                row.current,
                false,
              )}
            {:else}
              {@const newest = row.versions[0]!}
              {@const open = expanded.has(newest.sha)}
              <div class="session">
                {@render versionButton(
                  newest,
                  open
                    ? describeTime(newest.committedAt)
                    : describeSession(
                        newest.committedAt,
                        row.versions[row.versions.length - 1]!.committedAt,
                        row.versions.length,
                      ),
                  false,
                  false,
                )}
                <button
                  type="button"
                  class="button button-ghost button-icon session-toggle"
                  aria-expanded={open}
                  aria-label={open ? "Hide saves" : `Show ${row.versions.length} saves`}
                  onclick={() => toggle(newest.sha)}
                >
                  <svg
                    class="icon chevron"
                    class:open
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M4.5 6l3.5 3.5L11.5 6" />
                  </svg>
                </button>
              </div>
              {#if open}
                <ul class="saves">
                  {#each row.versions.slice(1) as version (version.sha)}
                    <li>
                      {@render versionButton(
                        version,
                        describeTime(version.committedAt),
                        false,
                        true,
                      )}
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  {#if versions.length === 0 && loading}
    <div aria-hidden="true">
      {#each [0, 1, 2, 3, 4] as i (i)}
        <div class="skeleton-row" style="--i: {i}">
          <span class="skeleton-bar short"></span>
          <span class="skeleton-bar"></span>
        </div>
      {/each}
    </div>
  {/if}

  <div class="list-end">
    {#if error !== null}
      <div class="list-error" role="alert">
        <span>{describeSyncError(error, forgeName)}</span>
        <button type="button" class="button" onclick={onRetry}>Retry</button>
      </div>
    {:else if end !== null}
      <p class="end-marker" data-testid="history-end">{describeHistoryEnd(end)}</p>
    {:else if loading}
      {#if versions.length > 0}
        <p class="end-marker">Loading…</p>
      {/if}
    {:else}
      <button
        type="button"
        class="button button-ghost load-more"
        use:loadWhenVisible
        onclick={onLoadMore}
      >
        {LOAD_OLDER_LABEL}
      </button>
    {/if}
  </div>
</div>

<style>
  .version-list {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .day + .day {
    margin-top: var(--space-2);
  }

  .day-header {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0;
    padding: var(--space-2) var(--space-3) var(--space-1);
    background: var(--color-surface-raised);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .rows,
  .saves {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .session {
    position: relative;
  }

  .session .version-row {
    padding-right: calc(var(--touch-target) + var(--space-1));
  }

  .version-row {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    width: 100%;
    min-height: var(--touch-target);
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    transition:
      background-color var(--motion-duration) var(--motion-easing),
      box-shadow var(--motion-duration) var(--motion-easing);
  }

  .version-row:hover {
    background: var(--color-hover);
  }

  .version-row:focus-visible {
    outline-offset: -2px;
  }

  .version-row.selected {
    background: var(--color-selected);
    box-shadow: inset 2px 0 0 var(--color-accent);
  }

  .version-row.sub {
    padding-left: calc(var(--space-3) + var(--space-3));
  }

  .version-line {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    font-variant-numeric: tabular-nums;
  }

  .version-row.selected time {
    font-weight: var(--font-weight-medium);
  }

  .current-badge {
    padding: 0 var(--space-1);
    border: var(--hairline) solid var(--color-border-strong);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    line-height: 1.4;
  }

  .version-meta {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--space-2);
    min-width: 0;
    font-size: var(--font-size-xs);
  }

  .version-labels {
    color: var(--color-text);
  }

  .version-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
  }

  .session-toggle {
    position: absolute;
    top: 50%;
    right: var(--space-1);
    translate: 0 -50%;
    color: var(--color-text-muted);
  }

  .session-toggle:hover {
    color: var(--color-text);
  }

  .chevron {
    transition: rotate var(--motion-duration) var(--motion-easing);
  }

  .chevron.open {
    rotate: 180deg;
  }

  .saves {
    animation: saves-open 180ms var(--motion-easing);
  }

  @keyframes saves-open {
    from {
      opacity: 0;
      translate: 0 -4px;
    }
  }

  .list-end {
    padding: var(--space-2) var(--space-3) var(--space-3);
  }

  .end-marker {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .load-more {
    width: 100%;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .list-error {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .skeleton-row {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
  }

  .skeleton-bar {
    display: block;
    height: 0.7rem;
    width: 70%;
    background: var(--color-hover);
    animation: skeleton-pulse 1.2s var(--motion-easing) infinite alternate;
    animation-delay: calc(var(--i) * 80ms);
  }

  .skeleton-bar.short {
    width: 35%;
  }

  @keyframes skeleton-pulse {
    to {
      opacity: 0.4;
    }
  }
</style>
