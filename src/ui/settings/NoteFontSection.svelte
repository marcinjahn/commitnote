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

<div>
  <div
    class="font-preview"
    data-testid="font-preview"
    aria-hidden="true"
    style:font-family={previewedFamily}
  >
    <p class="font-preview-heading">Weekly notes</p>
    <p>A <strong>clear</strong> list keeps the week <em>calm</em>.</p>
    <p>Run <code>cargo clippy</code> before you push.</p>
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
      <span style:font-family={option.family}>{option.label}</span>
    {/snippet}
  </SettingOptionList>
</div>

<style>
  .font-preview {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    margin-bottom: var(--space-2);
    font-size: var(--font-size-base);
  }

  .font-preview p {
    margin: 0;
    height: 1.5rem;
    line-height: 1.5rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .font-preview p + p {
    margin-top: var(--space-1);
  }

  .font-preview .font-preview-heading {
    height: 1.875rem;
    line-height: 1.875rem;
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-size-lg);
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
