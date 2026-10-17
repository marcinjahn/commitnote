<script lang="ts">
  import { exportNotesArchive } from "../../export/export-notes-archive";
  import type { SyncEngine } from "../../sync/sync-engine";
  import { KEY_CHANGED_MESSAGE } from "../browse/sync-messages";
  import Wordmark from "../wordmark/Wordmark.svelte";

  interface Props {
    engine: SyncEngine;
    unsavedCount: number;
    onLogInAgain: () => void;
  }

  const { engine, unsavedCount, onLogInAgain }: Props = $props();

  let exporting = $state(false);
  let exportFailed = $state(false);

  const unsavedMessage = $derived(
    unsavedCount === 0
      ? "All your changes were saved before this happened."
      : `${unsavedCount} ${unsavedCount === 1 ? "note or folder was" : "notes or folders were"} not saved and are lost when you log in again. Export your notes first to keep them.`,
  );

  async function handleExport(): Promise<void> {
    const snapshot = engine.snapshotNotes();
    if (snapshot === null || exporting) return;
    exporting = true;
    exportFailed = false;
    try {
      await exportNotesArchive(snapshot);
    } catch {
      exportFailed = true;
    } finally {
      exporting = false;
    }
  }
</script>

<main class="key-changed-shell">
  <div class="key-changed-card">
    <Wordmark />
    <h1>Passphrase changed</h1>
    <p role="alert">{KEY_CHANGED_MESSAGE}</p>
    <p class="unsaved">{unsavedMessage}</p>
    {#if exportFailed}
      <p role="alert" class="alert-error">Export failed. Try again.</p>
    {/if}
    <div class="actions">
      <button
        type="button"
        class="button"
        class:button-primary={unsavedCount > 0}
        disabled={exporting}
        onclick={() => void handleExport()}
      >
        {exporting ? "Exporting…" : unsavedCount > 0 ? "Export unsaved notes" : "Export notes"}
      </button>
      <button
        type="button"
        class="button"
        class:button-primary={unsavedCount === 0}
        class:button-danger={unsavedCount > 0}
        onclick={onLogInAgain}
      >
        Log in again
      </button>
    </div>
  </div>
</main>

<style>
  .key-changed-shell {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-background);
    padding: calc(var(--space-5) + env(safe-area-inset-top)) calc(var(--space-4) + env(safe-area-inset-right)) var(--space-5) calc(var(--space-4) + env(safe-area-inset-left));
  }

  .key-changed-card {
    width: 100%;
    max-width: var(--login-card-width);
    display: grid;
    gap: var(--space-3);
    background: var(--color-surface-raised);
    border: var(--hairline) solid var(--color-border);
    border-radius: var(--radius);
    padding: var(--space-5);
    box-shadow: var(--shadow-2);
  }

  h1 {
    margin: 0;
    font-size: var(--font-size-lg);
  }

  p {
    margin: 0;
  }

  .unsaved {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  @media (max-width: 767px) {
    .key-changed-shell {
      padding: var(--space-4) var(--space-3);
    }

    .key-changed-card {
      border: none;
      box-shadow: none;
    }

    .actions {
      flex-direction: column;
    }
  }
</style>
