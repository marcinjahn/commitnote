<script module lang="ts">
  import type { NoteHistoryCursor } from "../../history/note-history";

  export type HistoryPhase =
    | { readonly kind: "saving" }
    | { readonly kind: "unsaved" }
    | { readonly kind: "ready"; readonly cursor: NoteHistoryCursor };
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { fly } from "svelte/transition";
  import type {
    NoteHistory,
    NoteHistoryState,
    NoteVersion,
    VersionContent,
  } from "../../history/note-history";
  import Dialog from "../dialogs/Dialog.svelte";
  import { prefersReducedMotion } from "../browse/drag-motion";
  import VersionDiff from "./VersionDiff.svelte";
  import VersionList from "./VersionList.svelte";
  import {
    describeDay,
    describeTime,
    SAVE_FIRST_MESSAGE,
    SAVING_CHANGES_MESSAGE,
    VERSION_HISTORY_LABEL,
  } from "./history-messages";

  interface Props {
    phase: HistoryPhase;
    noteHistory: NoteHistory;
    /** The open note's text, unsaved edits included; null when it isn't open. */
    current: string | null;
    currentName: string;
    forgeName: string;
    onRetryPrepare: () => void;
    onClose: () => void;
  }

  const {
    phase,
    noteHistory,
    current,
    currentName,
    forgeName,
    onRetryPrepare,
    onClose,
  }: Props = $props();

  const KEYBOARD_READ_DELAY_MS = 150;

  let history = $state<NoteHistoryState | null>(null);
  let selectedSha = $state<string | null>(null);
  let contents = $state<ReadonlyMap<string, VersionContent>>(new Map());
  let mobileView = $state<"list" | "detail">("list");
  let preselecting = false;
  let readTimer: ReturnType<typeof setTimeout> | undefined;
  let backButton: HTMLButtonElement | undefined = $state();
  const now = Date.now();

  $effect(() => {
    if (phase.kind !== "ready") {
      history = null;
      return;
    }
    return phase.cursor.subscribe((next) => {
      history = next;
    });
  });

  $effect(() => () => clearTimeout(readTimer));

  const versions = $derived(history?.versions ?? []);
  const selected = $derived(
    versions.find((version) => version.sha === selectedSha) ?? null,
  );
  const selectedContent = $derived(
    selected === null ? null : (contents.get(selected.sha) ?? null),
  );

  function storeContent(sha: string, content: VersionContent): void {
    contents = new Map([...contents, [sha, content]]);
  }

  async function readContent(version: NoteVersion): Promise<VersionContent> {
    const known = contents.get(version.sha);
    if (known !== undefined && known.kind !== "failed") return known;
    let content: VersionContent;
    try {
      content = await noteHistory.readVersion(version);
    } catch {
      content = { kind: "failed", error: { kind: "server" } };
    }
    storeContent(version.sha, content);
    return content;
  }

  function retryContent(): void {
    if (selected === null) return;
    const next = new Map(contents);
    next.delete(selected.sha);
    contents = next;
    void readContent(selected);
  }

  // On narrow screens the list comes first and nothing is selected for the user.
  function isNarrow(): boolean {
    return !window.matchMedia("(min-width: 768px)").matches;
  }

  // The newest version that differs from the note as it is now.
  $effect(() => {
    if (history === null || selectedSha !== null || preselecting) return;
    if (isNarrow()) return;
    const [newest, older] = history.versions;
    if (newest === undefined || (older === undefined && history.loading)) {
      return;
    }
    preselecting = true;
    void readContent(newest).then((content) => {
      if (selectedSha !== null) return;
      const same =
        content.kind === "readable" &&
        content.content === current &&
        content.name === currentName;
      const pick = same && older !== undefined ? older : newest;
      selectedSha = pick.sha;
      void readContent(pick);
    });
  });

  async function handleSelect(
    version: NoteVersion,
    via: "pointer" | "keyboard",
  ): Promise<void> {
    selectedSha = version.sha;
    clearTimeout(readTimer);
    if (via === "keyboard") {
      readTimer = setTimeout(
        () => void readContent(version),
        KEYBOARD_READ_DELAY_MS,
      );
      return;
    }
    void readContent(version);
    if (mobileView !== "detail") {
      mobileView = "detail";
      if (isNarrow()) {
        await tick();
        backButton?.focus();
      }
    }
  }

  async function handleBack(): Promise<void> {
    mobileView = "list";
    await tick();
    document
      .querySelector<HTMLElement>(`[data-version-sha="${selectedSha}"]`)
      ?.focus();
  }

  function detailIn(node: Element) {
    return fly(node, {
      y: 4,
      duration: prefersReducedMotion() ? 0 : 180,
    });
  }
</script>

<Dialog open={true} title={VERSION_HISTORY_LABEL} wide closeButton {onClose}>
  {#snippet children()}
    {#if phase.kind === "saving"}
      <div class="phase-message" role="status">
        <progress aria-label={SAVING_CHANGES_MESSAGE}></progress>
        <p>{SAVING_CHANGES_MESSAGE}</p>
      </div>
    {:else if phase.kind === "unsaved"}
      <div class="phase-message">
        <p>{SAVE_FIRST_MESSAGE}</p>
        <button type="button" class="button" onclick={onRetryPrepare}>Retry</button>
      </div>
    {:else if history !== null}
      <div class="history-layout" class:detail={mobileView === "detail"}>
        <div class="list-pane">
          <VersionList
            {versions}
            end={history.end}
            loading={history.loading}
            error={history.error}
            {forgeName}
            {currentName}
            {selectedSha}
            {now}
            onSelect={(version, via) => void handleSelect(version, via)}
            onLoadMore={() => void phase.cursor.loadMore()}
            onRetry={() => void phase.cursor.retry()}
          />
        </div>
        <div class="detail-pane" data-testid="version-detail">
          {#if selected !== null}
            <div class="detail-header">
              <button
                bind:this={backButton}
                type="button"
                class="button button-ghost back-to-list"
                onclick={() => void handleBack()}
              >
                <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M10 3L5 8l5 5" />
                </svg>
                All versions
              </button>
              <span class="detail-date">
                {describeDay(selected.committedAt, now)}, {describeTime(selected.committedAt)}
              </span>
            </div>
            {#key selected.sha}
              <div class="detail-body" in:detailIn>
                <VersionDiff
                  content={selectedContent}
                  {current}
                  {currentName}
                  {forgeName}
                  onRetry={retryContent}
                />
              </div>
            {/key}
          {/if}
        </div>
      </div>
    {/if}
  {/snippet}
</Dialog>

<style>
  .phase-message {
    display: grid;
    padding-inline: var(--space-3);
    gap: var(--space-3);
    justify-items: start;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .phase-message p {
    margin: 0;
  }

  .phase-message progress {
    width: 8rem;
    height: 2px;
  }

  .history-layout {
    display: flex;
    flex: 1;
    min-height: 0;
    border-top: var(--hairline) solid var(--color-border);
  }

  .list-pane,
  .detail-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .list-pane {
    animation: list-back 220ms var(--motion-easing);
  }

  .detail-pane {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 var(--space-3)
      calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
    animation: detail-push 260ms var(--motion-easing);
  }

  .history-layout.detail .list-pane,
  .history-layout:not(.detail) .detail-pane {
    display: none;
  }

  .detail-header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-inline: calc(-1 * var(--space-3));
    padding: var(--space-1) var(--space-3);
    margin-bottom: var(--space-2);
    background: var(--color-surface-raised);
    border-bottom: var(--hairline) solid var(--color-border);
  }

  .back-to-list {
    gap: var(--space-1);
    margin-left: calc(-1 * var(--space-2));
    padding: 0 var(--space-2);
  }

  .detail-date {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    font-variant-numeric: tabular-nums;
  }

  @keyframes detail-push {
    from {
      translate: 24% 0;
      opacity: 0;
    }
  }

  @keyframes list-back {
    from {
      translate: -12% 0;
      opacity: 0;
    }
  }

  @media (min-width: 768px) {
    .history-layout {
      border: var(--hairline) solid var(--color-border);
    }

    .list-pane {
      flex: 0 0 18rem;
      border-right: var(--hairline) solid var(--color-border);
      animation: none;
    }

    .detail-pane {
      padding: 0 var(--space-4) var(--space-4);
      animation: none;
    }

    .history-layout.detail .list-pane,
    .history-layout:not(.detail) .detail-pane {
      display: flex;
    }

    .detail-header {
      position: static;
      margin: 0;
      padding: var(--space-3) 0 var(--space-1);
      border-bottom: none;
      background: none;
    }

    .back-to-list {
      display: none;
    }

    .detail-date {
      margin-left: 0;
      color: var(--color-text);
      font-weight: var(--font-weight-medium);
    }
  }
</style>
