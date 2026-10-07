<script lang="ts">
  import {
    CORNER_STYLE_OPTIONS,
    type CornerStyle,
  } from "../../settings/corner-style";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings }: SettingsSectionProps = $props();

  const DESCRIPTIONS: Record<CornerStyle, string> = {
    rounded: "Soft corners",
    square: "Sharp corners",
  };

  const selected = $derived(
    CORNER_STYLE_OPTIONS.find((option) => option.id === settings.cornerStyle) ??
      CORNER_STYLE_OPTIONS[0],
  );
</script>

<div class="corner-styles" role="radiogroup" aria-label="Corners">
  {#each CORNER_STYLE_OPTIONS as option (option.id)}
    <label class="corner-style" title={option.label}>
      <input
        type="radio"
        class="visually-hidden"
        name="corner-style"
        value={option.id}
        aria-label={option.label}
        checked={settings.cornerStyle === option.id}
        onchange={() => changeSettings({ cornerStyle: option.id })}
      />
      <span class="preview-card" aria-hidden="true">
        <span class="mock" data-corners={option.id}>
          <span class="mock-sidebar">
            <span class="mock-row"></span>
            <span class="mock-row selected"></span>
            <span class="mock-row"></span>
          </span>
          <span class="mock-content">
            <span class="mock-line title"></span>
            <span class="mock-line"></span>
            <span class="mock-line short"></span>
          </span>
          <span class="mock-menu">
            <span class="mock-menu-item"></span>
            <span class="mock-menu-item"></span>
          </span>
          <span class="mock-button"></span>
        </span>
      </span>
      <span class="corner-style-label">{option.label}</span>
    </label>
  {/each}
</div>
<p class="field-hint corner-style-caption" aria-hidden="true">
  <strong>{selected.label}</strong> · {DESCRIPTIONS[selected.id]}
</p>

<style>
  .corner-styles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .corner-style {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    cursor: pointer;
  }

  .preview-card {
    position: relative;
    display: block;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    border: var(--hairline) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    transition:
      transform var(--motion-duration) var(--motion-easing),
      box-shadow var(--motion-duration) var(--motion-easing);
  }

  .corner-style:hover .preview-card {
    transform: translateY(-2px);
    box-shadow: var(--shadow-2);
  }

  input:checked + .preview-card {
    box-shadow:
      0 0 0 2px var(--color-background),
      0 0 0 4px var(--color-text);
  }

  .corner-style:hover input:checked + .preview-card {
    box-shadow:
      0 0 0 2px var(--color-background),
      0 0 0 4px var(--color-text),
      var(--shadow-2);
  }

  input:focus-visible + .preview-card {
    outline: 2px solid var(--color-focus);
    outline-offset: 6px;
  }

  .mock {
    position: absolute;
    inset: 8px;
    display: grid;
    grid-template-columns: 32% 1fr;
    overflow: hidden;
    border: var(--hairline) solid var(--color-border);
    background: var(--color-background);
  }

  .mock[data-corners="rounded"] {
    border-radius: 6px;
  }

  .mock-sidebar {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 8px 5px;
    background: var(--color-surface);
    border-right: var(--hairline) solid var(--color-border);
  }

  .mock-row {
    height: 7px;
    background: var(--color-text-muted);
    opacity: 0.45;
  }

  .mock-row.selected {
    background: var(--color-selected-accent);
    opacity: 1;
    box-shadow: inset 2px 0 0 var(--color-accent);
  }

  .mock[data-corners="rounded"] .mock-row {
    border-radius: 2px;
  }

  .mock-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 8px;
    background: var(--color-surface-raised);
  }

  .mock-line {
    height: 4px;
    background: var(--color-text-muted);
    opacity: 0.55;
  }

  .mock-line.title {
    width: 55%;
    height: 6px;
    margin-bottom: 2px;
    background: var(--color-text);
    opacity: 1;
  }

  .mock-line.short {
    width: 70%;
  }

  .mock-menu {
    position: absolute;
    left: 38%;
    top: 46%;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 34%;
    padding: 4px;
    border: var(--hairline) solid var(--color-border-strong);
    background: var(--color-background);
    box-shadow: var(--shadow-2);
  }

  .mock[data-corners="rounded"] .mock-menu {
    border-radius: 4px;
  }

  .mock-menu-item {
    height: 4px;
    background: var(--color-text-muted);
    opacity: 0.45;
  }

  .mock[data-corners="rounded"] .mock-menu-item {
    border-radius: 2px;
  }

  .mock-button {
    position: absolute;
    right: 6px;
    bottom: 6px;
    width: 22%;
    height: 9px;
    background: var(--color-accent);
  }

  .mock[data-corners="rounded"] .mock-button {
    border-radius: 2px;
  }

  .corner-style-label {
    font-size: var(--font-size-sm);
    color: var(--color-text);
  }

  .corner-style-caption {
    margin: var(--space-2) 0 0;
  }

  .corner-style-caption strong {
    color: var(--color-text);
    font-weight: 500;
  }
</style>
