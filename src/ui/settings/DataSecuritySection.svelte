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
      class="link-button action"
      disabled={exportDisabled}
      onclick={onExport}
    >
      {exporting ? "Exporting…" : "Export notes"}
    </button>
    <button
      type="button"
      class="link-button action"
      disabled={importDisabled}
      onclick={() => importInput?.click()}
    >
      {importing ? "Importing…" : "Import notes"}
    </button>
    <button
      type="button"
      class="link-button action"
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
    flex-direction: column;
    align-items: flex-start;
  }

  .data-security .action {
    display: inline-flex;
    align-items: center;
    min-height: var(--touch-target);
    text-align: left;
    text-decoration: none;
    text-underline-offset: 3px;
  }

  .data-security .action:focus-visible {
    text-decoration: underline;
  }

  @media (hover: hover) {
    .data-security .action:hover:not(:disabled) {
      text-decoration: underline;
    }
  }

  .data-security .action:disabled {
    color: var(--color-text-muted);
    cursor: default;
  }

  @media (min-width: 768px) {
    .data-security .action {
      min-height: 32px;
    }
  }
</style>
