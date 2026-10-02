<script lang="ts">
  import type { Keyring } from "../../crypto/keyring";
  import type {
    CommitPassphraseChangeResult,
    HistoryOutcome,
    LandedCheck,
    PassphraseChange,
    PassphraseChangeFailure,
    PassphraseChangeStep,
    PreparedPassphraseChange,
  } from "../../rekey/change-passphrase";
  import Dialog from "../dialogs/Dialog.svelte";
  import { ENABLE_ATOMIC_LABEL } from "../import/import-messages";
  import PassphraseStrength from "./PassphraseStrength.svelte";
  import {
    describeCarriedOver,
    describeChangeAtomicSetup,
    describeChangeFailure,
    describeChangeStep,
    describeRekeySummary,
    describeRemoveHistory,
    ENTER_CURRENT_PASSPHRASE,
    HISTORY_WARNING,
    NEW_PASSPHRASE_HINT,
    OTHER_DEVICES_WARNING,
    PASSPHRASES_DIFFER,
    REMOVE_HISTORY_LABEL,
    REMOVE_HISTORY_REVIEW,
  } from "./passphrase-messages";

  interface Props {
    open: boolean;
    forgeName: string;
    repositoryLabel: string;
    change: PassphraseChange;
    onChanged: (
      keyring: Keyring,
      check: LandedCheck,
      history: HistoryOutcome,
    ) => void;
    onLogOut: () => void;
    onClose: () => void;
  }

  const {
    open,
    forgeName,
    repositoryLabel,
    change,
    onChanged,
    onLogOut,
    onClose,
  }: Props = $props();

  const uid = $props.id();
  const formId = `change-passphrase-form-${uid}`;
  const currentId = `change-passphrase-current-${uid}`;
  const newId = `change-passphrase-new-${uid}`;
  const repeatId = `change-passphrase-repeat-${uid}`;
  const hintId = `change-passphrase-hint-${uid}`;
  const strengthId = `change-passphrase-strength-${uid}`;
  const removeHistoryHintId = `change-passphrase-remove-history-hint-${uid}`;

  type Stage =
    | { readonly kind: "form" }
    | { readonly kind: "working"; readonly step: PassphraseChangeStep | null }
    | { readonly kind: "setup"; readonly canConfigure: boolean }
    | { readonly kind: "review"; readonly prepared: PreparedPassphraseChange }
    | {
        readonly kind: "unsettled";
        readonly prepared: PreparedPassphraseChange;
        readonly checking: boolean;
      };

  // Raw: a deep proxy around the prepared keyring could not be stored in
  // IndexedDB when the session is remembered.
  let stage = $state.raw<Stage>({ kind: "form" });
  let currentPassphrase = $state("");
  let newPassphrase = $state("");
  let repeatedPassphrase = $state("");
  let removeHistory = $state(false);
  let error = $state<string | null>(null);
  let currentInput: HTMLInputElement | undefined = $state();
  let confirmButton: HTMLButtonElement | undefined = $state();
  let setupButton: HTMLButtonElement | undefined = $state();

  const working = $derived(
    stage.kind === "working" || stage.kind === "unsettled",
  );
  // The engine is suspended from the first step until the change is
  // committed or cancelled.
  const engineHeld = $derived(stage.kind !== "form" && stage.kind !== "setup");
  const title = $derived(
    stage.kind === "review"
      ? "Ready to change passphrase"
      : stage.kind === "unsettled"
        ? "Checking the passphrase change"
      : stage.kind === "setup"
        ? "Project setting needed"
        : "Change passphrase",
  );
  const stepLabel = $derived(
    stage.kind === "working" && stage.step !== null
      ? describeChangeStep(stage.step)
      : "Starting…",
  );
  const progress = $derived(
    stage.kind === "working" &&
      (stage.step?.kind === "reading" || stage.step?.kind === "encrypting") &&
      stage.step.total > 0
      ? { value: stage.step.done, max: stage.step.total }
      : null,
  );

  $effect(() => {
    if (!engineHeld) return;
    function guard(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  });

  $effect(() => {
    if (stage.kind === "review") confirmButton?.focus();
    else if (stage.kind === "setup") setupButton?.focus();
  });

  function showFailure(failure: PassphraseChangeFailure): void {
    if (failure.kind === "needsSetup") {
      stage = { kind: "setup", canConfigure: failure.canConfigure };
      error = null;
      return;
    }
    stage = { kind: "form" };
    error = describeChangeFailure(failure, forgeName, Date.now());
    if (failure.kind === "wrongPassphrase") {
      currentPassphrase = "";
      queueMicrotask(() => currentInput?.focus());
    }
  }

  function onStep(step: PassphraseChangeStep): void {
    if (stage.kind === "working") stage = { kind: "working", step };
  }

  async function prepare(): Promise<void> {
    if (working) return;
    if (currentPassphrase === "") {
      error = ENTER_CURRENT_PASSPHRASE;
      return;
    }
    if (newPassphrase !== repeatedPassphrase) {
      error = PASSPHRASES_DIFFER;
      return;
    }
    error = null;
    stage = { kind: "working", step: null };
    const result = await change.prepare(
      { currentPassphrase, newPassphrase, removeHistory },
      onStep,
    );
    if (result.ok) {
      stage = { kind: "review", prepared: result.prepared };
    } else {
      showFailure(result.failure);
    }
  }

  function finish(
    prepared: PreparedPassphraseChange,
    result: CommitPassphraseChangeResult,
  ): void {
    if (result.ok) {
      currentPassphrase = "";
      newPassphrase = "";
      repeatedPassphrase = "";
      onChanged(result.keyring, result.check, result.history);
    } else if (result.unsettled === true) {
      stage = { kind: "unsettled", prepared, checking: false };
      error = describeChangeFailure(result.failure, forgeName, Date.now());
    } else {
      showFailure(result.failure);
    }
  }

  async function commit(): Promise<void> {
    if (stage.kind !== "review") return;
    const { prepared } = stage;
    stage = { kind: "working", step: { kind: "uploading" } };
    finish(prepared, await change.commit(prepared, onStep));
  }

  async function checkAgain(): Promise<void> {
    if (stage.kind !== "unsettled" || stage.checking) return;
    const { prepared } = stage;
    stage = { kind: "unsettled", prepared, checking: true };
    finish(prepared, await change.settle(prepared));
  }

  async function enableAndRetry(): Promise<void> {
    if (stage.kind !== "setup") return;
    stage = { kind: "working", step: null };
    let enabled = false;
    try {
      enabled = (await change.enableAtomicCommits()).kind === "available";
    } catch {
      enabled = false;
    }
    if (!enabled) {
      stage = { kind: "form" };
      error = `Couldn't change the ${forgeName} project settings. Try again later.`;
      return;
    }
    await prepare();
  }

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void prepare();
  }

  function cancelReview(): void {
    if (stage.kind !== "review") return;
    change.cancel();
    stage = { kind: "form" };
  }

  function handleClose(): void {
    if (working) return;
    if (stage.kind === "review") change.cancel();
    onClose();
  }
</script>

<Dialog {open} {title} onClose={handleClose} closeButton={!working}>
  {#snippet children()}
    {#if error !== null}
      <p role="alert" class="alert-error">{error}</p>
    {/if}
    {#if stage.kind === "review"}
      <div class="review">
        <p>{describeRekeySummary(stage.prepared.summary)}</p>
        {#if stage.prepared.removeHistory}
          <p>{REMOVE_HISTORY_REVIEW}</p>
        {/if}
        {#each describeCarriedOver(stage.prepared.summary) as line (line)}
          <p class="field-hint">{line}</p>
        {/each}
        <p class="field-hint">{OTHER_DEVICES_WARNING}</p>
      </div>
    {:else if stage.kind === "setup"}
      <p>{describeChangeAtomicSetup(forgeName, stage.canConfigure)}</p>
    {:else if stage.kind === "unsettled"}
      <p class="field-hint">{OTHER_DEVICES_WARNING}</p>
    {:else}
      <form id={formId} class="passphrase-form" onsubmit={handleSubmit}>
        <fieldset disabled={working}>
          <div class="field">
            <label for={currentId}>Current passphrase</label>
            <input
              id={currentId}
              type="password"
              autocomplete="current-password"
              bind:this={currentInput}
              bind:value={currentPassphrase}
            />
          </div>
          <div class="field">
            <label for={newId}>New passphrase</label>
            <input
              id={newId}
              type="password"
              autocomplete="new-password"
              aria-describedby="{hintId} {strengthId}"
              bind:value={newPassphrase}
            />
            <p id={hintId} class="field-hint">{NEW_PASSPHRASE_HINT}</p>
            <PassphraseStrength
              id={strengthId}
              passphrase={newPassphrase}
              {repositoryLabel}
            />
          </div>
          <div class="field">
            <label for={repeatId}>Repeat new passphrase</label>
            <input
              id={repeatId}
              type="password"
              autocomplete="new-password"
              bind:value={repeatedPassphrase}
            />
          </div>
          {#if change.canRemoveHistory}
            <div class="remove-history">
              <label class="checkbox-field">
                <input
                  type="checkbox"
                  aria-describedby={removeHistoryHintId}
                  bind:checked={removeHistory}
                />
                {REMOVE_HISTORY_LABEL}
              </label>
              <p id={removeHistoryHintId} class="field-hint">
                {describeRemoveHistory(forgeName)}
              </p>
            </div>
          {/if}
        </fieldset>
        <div class="warnings">
          {#if !removeHistory}
            <p class="field-hint">{HISTORY_WARNING}</p>
          {/if}
          <p class="field-hint">{OTHER_DEVICES_WARNING}</p>
        </div>
      </form>
    {/if}
    {#if stage.kind === "working"}
      <div role="status" class="step-progress">
        {#if progress !== null}
          <progress value={progress.value} max={progress.max}></progress>
        {:else}
          <progress></progress>
        {/if}
        <span>{stepLabel}</span>
      </div>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if stage.kind === "unsettled"}
      <button
        type="button"
        class="button button-primary"
        disabled={stage.checking}
        onclick={() => void checkAgain()}
      >
        {stage.checking ? "Checking…" : "Check again"}
      </button>
      <button type="button" class="button button-ghost" onclick={onLogOut}>
        Log out
      </button>
    {:else if stage.kind === "review"}
      <button
        type="button"
        class="button button-primary"
        bind:this={confirmButton}
        onclick={() => void commit()}
      >
        Change passphrase
      </button>
      <button type="button" class="button button-ghost" onclick={cancelReview}>
        Back
      </button>
    {:else if stage.kind === "setup"}
      {#if stage.canConfigure}
        <button
          type="button"
          class="button button-primary"
          bind:this={setupButton}
          onclick={() => void enableAndRetry()}
        >
          {ENABLE_ATOMIC_LABEL}
        </button>
      {/if}
      <button
        type="button"
        class="button button-ghost"
        onclick={() => (stage = { kind: "form" })}
      >
        Back
      </button>
    {:else}
      <button
        type="submit"
        form={formId}
        class="button button-primary"
        disabled={working}
      >
        {working ? "Changing…" : "Continue"}
      </button>
    {/if}
    {#if stage.kind !== "unsettled"}
      <button
        type="button"
        class="button button-ghost"
        disabled={working}
        onclick={handleClose}
      >
        Cancel
      </button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .passphrase-form,
  .review {
    display: grid;
    gap: var(--space-3);
  }

  .passphrase-form fieldset {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    border: none;
    min-width: 0;
  }

  .review p,
  .warnings p,
  .remove-history p {
    margin: 0;
  }

  .remove-history {
    display: grid;
    gap: var(--space-1);
  }

  .warnings {
    display: grid;
    gap: var(--space-2);
  }

  .step-progress {
    display: grid;
    gap: var(--space-1);
    margin-top: var(--space-3);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .step-progress progress {
    width: 100%;
    height: var(--space-1);
  }
</style>
