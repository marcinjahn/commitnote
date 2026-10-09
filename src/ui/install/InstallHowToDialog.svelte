<script lang="ts">
  import Dialog from "../dialogs/Dialog.svelte";

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  const { open, onClose }: Props = $props();
</script>

<Dialog {open} title="Install commitnote" {onClose}>
  {#snippet children()}
    <ol class="steps">
      <li>Tap the Share button in Safari's toolbar.</li>
      <li>Choose Add to Home Screen.</li>
      <li>Keep Open as Web App turned on, then tap Add.</li>
      <li>Open commitnote from the new icon on your Home Screen.</li>
    </ol>
    <p>The installed app keeps its own storage, so you log in again there.</p>
  {/snippet}
  {#snippet actions()}
    <button type="button" class="button button-primary" onclick={onClose}>
      Done
    </button>
  {/snippet}
</Dialog>

<style>
  .steps {
    margin: 0 0 var(--space-3);
    padding-inline-start: var(--space-5, 1.5rem);
  }
</style>
