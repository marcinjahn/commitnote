<script lang="ts">
  import type { DataSecurityActions } from "./data-security-actions";

  const {
    exporting,
    exportDisabled,
    onExport,
    importing,
    importDisabled,
    onImportFile,
    changePassphraseDisabled,
    onChangePassphrase,
  }: DataSecurityActions = $props();

  let importInput: HTMLInputElement | undefined = $state();

  function onImportChange(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (file) onImportFile(file);
  }
</script>

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
    accept=".zip,application/zip"
    class="visually-hidden"
    tabindex="-1"
    aria-hidden="true"
    data-testid="import-file"
    onchange={onImportChange}
  />
</div>

<style>
  .data-security {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
  }

  .data-security .button {
    justify-content: flex-start;
  }

  @media (min-width: 768px) {
    .data-security {
      align-items: flex-start;
    }
  }
</style>
