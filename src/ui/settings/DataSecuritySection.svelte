<script lang="ts">
  import SettingRow from "./SettingRow.svelte";
  import type { DataSecurityActions } from "./data-security-actions";

  const {
    exporting,
    exportDisabled,
    onExport,
    importing,
    importDisabled,
    onImportFiles,
    changePassphraseDisabled,
    onChangePassphrase,
  }: DataSecurityActions = $props();

  let importInput: HTMLInputElement | undefined = $state();

  function onImportChange(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) onImportFiles(files);
  }
</script>

<SettingRow stacked>
  {#snippet label()}
    <span class="visually-hidden">Data &amp; security actions</span>
  {/snippet}
  <div class="data-security">
    <button
      type="button"
      class="button"
      disabled={exportDisabled}
      onclick={onExport}
    >
      {exporting ? "Exporting…" : "Export notes"}
    </button>
    <button
      type="button"
      class="button"
      disabled={importDisabled}
      onclick={() => importInput?.click()}
    >
      {importing ? "Importing…" : "Import notes"}
    </button>
    <button
      type="button"
      class="button"
      disabled={changePassphraseDisabled}
      onclick={onChangePassphrase}
    >
      Change passphrase
    </button>
    <input
      bind:this={importInput}
      type="file"
      accept=".zip,application/zip,.md,.markdown,.txt"
      multiple
      class="visually-hidden"
      tabindex="-1"
      aria-hidden="true"
      data-testid="import-file"
      onchange={onImportChange}
    />
  </div>
</SettingRow>

<style>
  .data-security {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .data-security .button:disabled {
    background: transparent;
    color: var(--color-text-muted);
    border-color: var(--color-text-muted);
    opacity: 1;
    cursor: default;
  }
</style>
