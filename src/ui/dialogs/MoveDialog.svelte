<script lang="ts">
  import { untrack } from "svelte";
  import type { NotePath } from "../../changes/change";
  import type { WorkingTree } from "../../sync/working-tree";
  import Dialog from "./Dialog.svelte";
  import FolderPicker from "./FolderPicker.svelte";
  import { listMoveTargets } from "./folder-options";

  interface Props {
    open: boolean;
    itemName: string;
    itemPath: NotePath | null;
    itemKind: "note" | "folder";
    tree: WorkingTree;
    error: string | null;
    restore?: boolean;
    onSubmit: (newParent: NotePath) => void;
    onClose: () => void;
  }

  const {
    open,
    itemName,
    itemPath,
    itemKind,
    tree,
    error,
    restore = false,
    onSubmit,
    onClose,
  }: Props = $props();

  const uid = $props.id();
  const formId = `move-dialog-form-${uid}`;

  let selected = $state<NotePath | null>(null);

  const title = $derived(
    restore ? `Restore “${itemName}” to folder` : `Move “${itemName}” to folder`,
  );
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
    {#if error !== null}
      <p role="alert" class="alert-error">{error}</p>
    {/if}
    <form id={formId} onsubmit={handleSubmit}>
      <FolderPicker
        {options}
        {selected}
        name="move-target"
        onSelect={(path) => (selected = path)}
      />
    </form>
  {/snippet}
  {#snippet actions()}
    <button
      type="submit"
      form={formId}
      class="button button-primary"
      disabled={selected === null}
    >
      {restore ? "Restore" : "Move"}
    </button>
    <button type="button" class="button button-ghost" onclick={onClose}>
      Cancel
    </button>
  {/snippet}
</Dialog>
