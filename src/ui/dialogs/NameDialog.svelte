<script lang="ts">
  import { untrack } from "svelte";
  import { validateName } from "../../tree/note-names";
  import Dialog from "./Dialog.svelte";
  import { describeNameError } from "./name-messages";

  interface Props {
    title: string;
    label: string;
    initialName: string;
    siblingNames?: readonly string[];
    placeholder?: string;
    maxLength?: number;
    validate?: (input: string) => string | null;
    submitLabel: string;
    error: string | null;
    onSubmit: (name: string) => void;
    onClose: () => void;
  }

  const {
    title,
    label,
    initialName,
    siblingNames = [],
    placeholder,
    maxLength,
    validate,
    submitLabel,
    error,
    onSubmit,
    onClose,
  }: Props = $props();

  const uid = $props.id();
  const formId = `name-dialog-form-${uid}`;
  const inputId = `name-dialog-input-${uid}`;
  const errorId = `name-dialog-error-${uid}`;

  let name = $state(untrack(() => initialName));
  let attempted = $state(false);

  const validationMessage = $derived.by(() => {
    if (validate !== undefined) return validate(name);
    const result = validateName(name, siblingNames);
    return result.ok ? null : describeNameError(result.error);
  });
  const valid = $derived(validationMessage === null);
  const showError = $derived(attempted && validationMessage !== null);

  function handleInput(): void {
    attempted = true;
  }

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    attempted = true;
    if (!valid) return;
    onSubmit(name);
  }
</script>

<Dialog open={true} {title} {onClose}>
  {#snippet children()}
    <form id={formId} onsubmit={handleSubmit}>
      <div class="field">
        <label for={inputId}>{label}</label>
        <input
          id={inputId}
          type="text"
          bind:value={name}
          {placeholder}
          maxlength={maxLength}
          oninput={handleInput}
          aria-describedby={errorId}
          aria-invalid={showError}
        />
        {#if showError}
          <p id={errorId} role="alert" class="alert-error">
            {validationMessage}
          </p>
        {:else if error !== null}
          <p id={errorId} role="alert" class="alert-error">
            {error}
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
      disabled={!valid}
    >
      {submitLabel}
    </button>
    <button type="button" class="button button-ghost" onclick={onClose}>
      Cancel
    </button>
  {/snippet}
</Dialog>
