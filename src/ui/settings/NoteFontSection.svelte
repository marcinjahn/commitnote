<script lang="ts">
  import {
    NOTE_FONT_OPTIONS,
    noteFontFamily,
    type NoteFont,
  } from "../../settings/note-font";
  import SettingOptionList from "./SettingOptionList.svelte";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings }: SettingsSectionProps = $props();

  let hovered = $state<NoteFont | null>(null);
  let focused = $state<NoteFont | null>(null);

  const previewed = $derived(hovered ?? focused ?? settings.noteFont);
  const previewedFamily = $derived(noteFontFamily(previewed));

  function onhighlight(kind: "hover" | "focus", id: NoteFont | null) {
    if (kind === "hover") hovered = id;
    else focused = id;
  }
</script>

<div class="font-picker">
  <div
    class="font-preview"
    data-testid="font-preview"
    aria-hidden="true"
    style:font-family={previewedFamily}
  >
    <p class="font-preview-heading">Weekly notes</p>
    <p>A <strong>clear</strong> list keeps a week <em>calm</em>.</p>
    <p class="font-preview-code">Run <code>cargo clippy</code> before you push.</p>
  </div>
  <SettingOptionList
    label="Note font"
    name="note-font"
    options={NOTE_FONT_OPTIONS}
    value={settings.noteFont}
    columns={2}
    {onhighlight}
    onSelect={(id) => changeSettings({ noteFont: id })}
  >
    {#snippet optionLabel(option)}
      <span class="font-label" style:font-family={option.family}>{option.label}</span>
    {/snippet}
  </SettingOptionList>
</div>

<style>
  .font-picker {
    container-type: inline-size;
  }

  .font-preview {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    padding: var(--space-3);
    margin-bottom: var(--space-2);
    font-size: var(--font-size-base);
  }

  .font-preview p {
    margin: 0;
    min-height: 1.5rem;
    line-height: 1.5;
  }

  .font-label {
    line-height: 0;
  }

  .font-preview p > * {
    line-height: 0;
  }

  .font-preview p + p {
    margin-top: var(--space-1);
  }

  .font-preview .font-preview-heading {
    min-height: 1.875rem;
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-size-lg);
  }

  /* Leaves room for the padded code box, which hangs below the line in fonts with a low baseline. */
  .font-preview .font-preview-code {
    min-height: 1.75rem;
  }

  /* Below this width the widest note fonts wrap a body line, so every font reserves two lines. */
  @container (max-width: 24.5rem) {
    .font-preview p:not(.font-preview-heading) {
      min-height: 3rem;
    }
  }

  strong {
    font-weight: var(--font-weight-semibold);
  }

  em {
    font-style: italic;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.875em;
    background-color: var(--color-code-surface);
    padding: 0.1em 0.3em;
  }
</style>
