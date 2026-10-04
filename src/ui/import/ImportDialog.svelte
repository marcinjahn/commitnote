<script lang="ts">
  import { untrack } from "svelte";
  import type { NotePath } from "../../changes/change";
  import {
    planImport,
    type CollisionPolicy,
    type ImportDestination,
  } from "../../import/plan-import";
  import type { NotesArchiveContents } from "../../import/read-notes-archive";
  import type { WorkingTree } from "../../sync/working-tree";
  import { validateName } from "../../tree/note-names";
  import Dialog from "../dialogs/Dialog.svelte";
  import FolderPicker from "../dialogs/FolderPicker.svelte";
  import { listMoveTargets } from "../dialogs/folder-options";
  import { describeNameError } from "../dialogs/name-messages";
  import {
    countSkipped,
    defaultImportFolderName,
    describeImportConflicts,
    describeAtomicSetup,
    describeImportCounts,
    describeSkipped,
    ENABLE_ATOMIC_LABEL,
  } from "./import-messages";
  import type { ImportOutcome } from "./import-outcome";

  interface Props {
    open: boolean;
    fileName: string;
    contents: NotesArchiveContents;
    tree: WorkingTree;
    forgeName: string;
    onEnableAtomic: () => Promise<string | null>;
    onImport: (
      destination: ImportDestination,
      policy: CollisionPolicy,
    ) => Promise<ImportOutcome>;
    onClose: () => void;
  }

  const {
    open,
    fileName,
    contents,
    tree,
    forgeName,
    onEnableAtomic,
    onImport,
    onClose,
  }: Props = $props();

  const uid = $props.id();
  const formId = `import-dialog-form-${uid}`;
  const nameId = `import-dialog-name-${uid}`;
  const nameErrorId = `import-dialog-name-error-${uid}`;

  let target = $state<"new-folder" | "folder">("new-folder");
  let folderName = $state(untrack(() => defaultImportFolderName(fileName)));
  let selected = $state<NotePath>([]);
  let conflicts = $state<number | null>(null);
  let setup = $state<{
    readonly canConfigure: boolean;
    readonly policy: CollisionPolicy;
  } | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let renameButton: HTMLButtonElement | undefined = $state();
  let setupButton: HTMLButtonElement | undefined = $state();
  let setupBackButton: HTMLButtonElement | undefined = $state();

  const nameValidation = $derived(validateName(folderName, []));
  const folderOptions = $derived(listMoveTargets(tree, null, "folder"));
  const destination = $derived.by((): ImportDestination | null => {
    if (target === "folder") {
      return selected.length === 0
        ? { kind: "root" }
        : { kind: "folder", path: selected };
    }
    return nameValidation.ok
      ? { kind: "new-folder", parent: [], name: nameValidation.name }
      : null;
  });
  const preview = $derived.by(() => {
    if (destination === null) return null;
    try {
      const plan = planImport(tree, destination, contents.entries, "rename");
      return plan.ok ? plan.summary : null;
    } catch {
      return null;
    }
  });
  const empty = $derived(contents.entries.length === 0);
  const skippedText = $derived(describeSkipped(countSkipped(contents.skipped)));
  const title = $derived(
    setup !== null
      ? "Project setting needed"
      : conflicts === null
        ? "Import notes"
        : "Name conflicts",
  );

  $effect(() => {
    if (setup !== null) (setupButton ?? setupBackButton)?.focus();
    else if (conflicts !== null) renameButton?.focus();
  });

  async function runImport(policy: CollisionPolicy): Promise<void> {
    if (destination === null || busy) return;
    busy = true;
    error = null;
    try {
      const outcome = await onImport(destination, policy);
      if (outcome.kind === "conflicts") {
        conflicts = outcome.count;
      } else if (outcome.kind === "needsSetup") {
        setup = { canConfigure: outcome.canConfigure, policy };
      } else if (outcome.kind === "error") {
        error = outcome.message;
      }
    } finally {
      busy = false;
    }
  }

  async function enableAndImport(): Promise<void> {
    if (setup === null || busy) return;
    const { policy } = setup;
    busy = true;
    error = null;
    let failure: string | null;
    try {
      failure = await onEnableAtomic();
    } finally {
      busy = false;
    }
    if (failure !== null) {
      error = failure;
      return;
    }
    setup = null;
    await runImport(policy);
  }

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void runImport("stop");
  }

  function handleClose(): void {
    if (!busy) onClose();
  }
</script>

<Dialog {open} {title} onClose={handleClose} closeButton={true} swipeToClose={!busy}>
  {#snippet children()}
    {#if error !== null}
      <p role="alert" class="alert-error">{error}</p>
    {/if}
    {#if setup !== null}
      <p>{describeAtomicSetup(forgeName, setup.canConfigure)}</p>
    {:else if conflicts !== null}
      <p>{describeImportConflicts(conflicts)}</p>
      <p class="field-hint">
        Rename the imported items to keep both, for example “Ideas (2)”, or
        cancel the import.
      </p>
    {:else}
      <form id={formId} class="import-form" onsubmit={handleSubmit}>
        <p class="file-name" title={fileName}>{fileName}</p>
        <fieldset class="targets" disabled={busy}>
          <legend>Import into</legend>
          <label class="target-option">
            <input
              type="radio"
              name="import-target"
              value="new-folder"
              bind:group={target}
            />
            <span>A new folder</span>
          </label>
          {#if target === "new-folder"}
            <div class="field target-detail">
              <label for={nameId}>Folder name</label>
              <input
                id={nameId}
                type="text"
                bind:value={folderName}
                aria-describedby={nameErrorId}
                aria-invalid={!nameValidation.ok}
              />
              {#if !nameValidation.ok}
                <p id={nameErrorId} role="alert" class="alert-error">
                  {describeNameError(nameValidation.error)}
                </p>
              {/if}
            </div>
          {/if}
          <label class="target-option">
            <input
              type="radio"
              name="import-target"
              value="folder"
              bind:group={target}
            />
            <span>An existing folder</span>
          </label>
          {#if target === "folder"}
            <div class="target-detail">
              <FolderPicker
                options={folderOptions}
                {selected}
                name="import-folder"
                onSelect={(path) => (selected = path)}
              />
            </div>
          {/if}
        </fieldset>
        <div class="summary" aria-live="polite">
          {#if empty}
            <p>The archive has no notes to import.</p>
          {:else if preview !== null}
            <p>Imports {describeImportCounts(preview.notes, preview.folders)}.</p>
          {/if}
          {#if skippedText !== null}
            <p class="field-hint">{skippedText}</p>
          {/if}
        </div>
      </form>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if setup !== null}
      {#if setup.canConfigure}
        <button
          type="button"
          class="button button-primary"
          bind:this={setupButton}
          disabled={busy}
          onclick={() => void enableAndImport()}
        >
          {busy ? "Importing…" : ENABLE_ATOMIC_LABEL}
        </button>
      {/if}
      <button
        type="button"
        class="button button-ghost"
        bind:this={setupBackButton}
        disabled={busy}
        onclick={() => {
          setup = null;
          error = null;
        }}
      >
        Back
      </button>
    {:else if conflicts !== null}
      <button
        type="button"
        class="button button-primary"
        bind:this={renameButton}
        disabled={busy}
        onclick={() => void runImport("rename")}
      >
        {busy ? "Importing…" : "Rename imported items"}
      </button>
      <button
        type="button"
        class="button button-ghost"
        disabled={busy}
        onclick={() => {
          conflicts = null;
          error = null;
        }}
      >
        Back
      </button>
    {:else}
      <button
        type="submit"
        form={formId}
        class="button button-primary"
        disabled={busy || empty || destination === null}
      >
        {busy ? "Importing…" : "Import"}
      </button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .import-form {
    display: grid;
    gap: var(--space-4);
  }

  .file-name {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .targets {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    border: none;
    min-width: 0;
  }

  .targets legend {
    padding: 0;
    margin-bottom: var(--space-1);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }

  .target-option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target);
    cursor: pointer;
  }

  .target-option input {
    flex-shrink: 0;
    width: var(--checkbox-size);
    height: var(--checkbox-size);
    margin: 0;
  }

  .target-detail {
    margin-left: calc(var(--checkbox-size) + var(--space-2));
    margin-bottom: var(--space-2);
  }

  .summary p {
    margin: 0;
  }

  .summary {
    display: grid;
    gap: var(--space-1);
  }
</style>
