<script lang="ts">
  import { ACCENT_PALETTE, type AccentOption } from "../../settings/accent-palette";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings }: SettingsSectionProps = $props();

  function swatchStyle(option: AccentOption): string | undefined {
    if (option.light === undefined || option.dark === undefined) {
      return undefined;
    }
    return `--swatch-light: ${option.light}; --swatch-dark: ${option.dark}`;
  }
</script>

<div class="accent-swatches" role="radiogroup" aria-label="Accent color">
  {#each ACCENT_PALETTE as option (option.id)}
    <label class="accent-swatch" title={option.label}>
      <input
        type="radio"
        class="visually-hidden"
        name="accent-color"
        value={option.id}
        aria-label={option.label}
        checked={settings.accentColor === option.id}
        onchange={() => changeSettings({ accentColor: option.id })}
      />
      <span class="accent-circle" style={swatchStyle(option)}></span>
    </label>
  {/each}
</div>

<style>
  .accent-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .accent-swatch {
    display: inline-flex;
    padding: 6px;
    cursor: pointer;
  }

  .accent-circle {
    display: block;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--swatch-light, var(--system-accent));
    transition: box-shadow var(--motion-duration) var(--motion-easing);
  }

  input:checked + .accent-circle {
    box-shadow:
      0 0 0 2px var(--color-background),
      0 0 0 4px var(--color-text);
  }

  input:focus-visible + .accent-circle {
    outline: 2px solid var(--color-focus);
    outline-offset: 6px;
  }

  @media (prefers-color-scheme: dark) {
    .accent-circle {
      background: var(--swatch-dark, var(--system-accent));
    }
  }
</style>
