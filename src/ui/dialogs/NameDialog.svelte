<script lang="ts">
  import { untrack } from "svelte";
  import { validateName } from "../../tree/note-names";
  import Dialog from "./Dialog.svelte";
  import { describeNameError } from "./name-messages";

  interface Props {
    open: boolean;
    title: string;
    label: string;
    initialName: string;
    siblingNames: readonly string[];
    submitLabel: string;
    onSubmit: (name: string) => void;
    onClose: () => void;
  }

  const {
    open,
    title,
    label,
    initialName,
    siblingNames,
    submitLabel,
    onSubmit,
    onClose,
  }: Props = $props();

  const uid = $props.id();
  const formId = `name-dialog-form-${uid}`;
  const inputId = `name-dialog-input-${uid}`;
  const errorId = `name-dialog-error-${uid}`;

  let name = $state(untrack(() => initialName));
  let attempted = $state(false);

  const validation = $derived(validateName(name, siblingNames));
  const showError = $derived(attempted && !validation.ok);

  // Runs before Dialog's own effect (which focuses and selects the field),
  // so the field already holds initialName when that selection happens.
  $effect.pre(() => {
    if (open) {
      untrack(() => {
        name = initialName;
        attempted = false;
      });
    }
  });

  function handleInput(): void {
    attempted = true;
  }

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    attempted = true;
    if (!validation.ok) return;
    onSubmit(name);
  }
</script>

<Dialog {open} {title} {onClose}>
  {#snippet children()}
    <form id={formId} onsubmit={handleSubmit}>
      <div class="field">
        <label for={inputId}>{label}</label>
        <input
          id={inputId}
          type="text"
          bind:value={name}
          oninput={handleInput}
          aria-describedby={errorId}
          aria-invalid={showError}
        />
        {#if showError && !validation.ok}
          <p id={errorId} role="alert" class="alert-error">
            {describeNameError(validation.error)}
          </p>
        {/if}
      </div>
    </form>
  {/snippet}
  {#snippet actions()}
    <button
      type="submit"
      form={formId}
      class="button button-primary"
      disabled={!validation.ok}
    >
      {submitLabel}
    </button>
    <button type="button" class="button button-ghost" onclick={onClose}>
      Cancel
    </button>
  {/snippet}
</Dialog>
