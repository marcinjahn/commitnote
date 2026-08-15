<script lang="ts">
  import { untrack } from "svelte";
  import type { NotePath } from "../../changes/change";
  import { notePathEquals } from "../../changes/change";
  import type { WorkingTree } from "../../sync/working-tree";
  import Dialog from "./Dialog.svelte";
  import { listMoveTargets } from "./folder-options";

  interface Props {
    open: boolean;
    itemName: string;
    itemPath: NotePath;
    itemKind: "note" | "folder";
    tree: WorkingTree;
    onSubmit: (newParent: NotePath) => void;
    onClose: () => void;
  }

  const { open, itemName, itemPath, itemKind, tree, onSubmit, onClose }: Props =
    $props();

  const uid = $props.id();
  const formId = `move-dialog-form-${uid}`;

  let selected = $state<NotePath | null>(null);

  const title = $derived(`Move “${itemName}” to folder`);
  const options = $derived(listMoveTargets(tree, itemPath, itemKind));

  $effect(() => {
    if (open) {
      untrack(() => {
        selected = null;
      });
    }
  });

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    if (selected === null) return;
    onSubmit(selected);
  }
</script>

<Dialog {open} {title} {onClose}>
  {#snippet children()}
    <form id={formId} onsubmit={handleSubmit}>
      <div class="folder-picker" role="radiogroup" aria-label="Folder">
        {#each options as option (option.path.join("/"))}
          <label class="folder-option" class:disabled={option.disabled}>
            <input
              type="radio"
              name="move-target"
              disabled={option.disabled}
              checked={selected !== null &&
                notePathEquals(selected, option.path)}
              onchange={() => (selected = option.path)}
            />
            <span
              class="folder-option-label"
              style="--depth: {option.depth}"
              title={option.path.length === 0
                ? option.label
                : option.path.join("/")}
            >
              {option.label}
              {#if option.disabled}
                <span class="folder-option-hint">(current folder)</span>
              {/if}
            </span>
          </label>
        {/each}
      </div>
    </form>
  {/snippet}
  {#snippet actions()}
    <button
      type="submit"
      form={formId}
      class="button button-primary"
      disabled={selected === null}
    >
      Move
    </button>
    <button type="button" class="button button-ghost" onclick={onClose}>
      Cancel
    </button>
  {/snippet}
</Dialog>

<style>
  .folder-picker {
    display: grid;
    gap: var(--space-1);
  }

  .folder-option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target);
    padding: 0 var(--space-2);
    border-radius: var(--radius);
    cursor: pointer;
  }

  .folder-option.disabled {
    cursor: not-allowed;
    color: var(--color-text-muted);
  }

  .folder-option:not(.disabled):hover {
    background: var(--color-hover);
  }

  .folder-option input {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
  }

  .folder-option-label {
    flex: 1;
    min-width: 0;
    padding-left: calc(var(--depth, 0) * 20px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder-option-hint {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
</style>
