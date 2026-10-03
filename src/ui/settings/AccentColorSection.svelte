<script lang="ts">
  import { ACCENT_PALETTE, type AccentOption } from "../../settings/accent-palette";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings }: SettingsSectionProps = $props();

  const SYSTEM_DESCRIPTION = "Matches your operating system's accent color";
  const descriptionId = $props.id();

  const selected = $derived(
    ACCENT_PALETTE.find((option) => option.id === settings.accentColor) ??
      ACCENT_PALETTE[0],
  );

  function swatchStyle(option: AccentOption): string | undefined {
    if (option.light === undefined || option.dark === undefined) {
      return undefined;
    }
    return `--swatch-light: ${option.light}; --swatch-dark: ${option.dark}`;
  }
</script>

<div class="accent-swatches" role="radiogroup" aria-label="Accent color">
  {#each ACCENT_PALETTE as option (option.id)}
    {@const system = option.id === "system"}
    <label
      class="accent-swatch"
      class:system
      title={system ? `${option.label}: ${SYSTEM_DESCRIPTION}` : option.label}
    >
      <input
        type="radio"
        class="visually-hidden"
        name="accent-color"
        value={option.id}
        aria-label={option.label}
        aria-describedby={system ? descriptionId : undefined}
        checked={settings.accentColor === option.id}
        onchange={() => changeSettings({ accentColor: option.id })}
      />
      <span class="accent-circle" style={swatchStyle(option)}>
        {#if system}
          <svg
            class="system-icon"
            viewBox="0 0 16 16"
            width="18"
            height="18"
            aria-hidden="true"
          >
            <path d="M2.75 3h10.5c.41 0 .75.34.75.75v6.5c0 .41-.34.75-.75.75H2.75a.75.75 0 0 1-.75-.75v-6.5c0-.41.34-.75.75-.75z" />
            <path d="M5.5 13.5h5M8 11v2.5" />
          </svg>
        {/if}
      </span>
    </label>
    {#if system}
      <span class="accent-divider" aria-hidden="true"></span>
    {/if}
  {/each}
</div>
<span id={descriptionId} class="visually-hidden">{SYSTEM_DESCRIPTION}</span>
<p class="field-hint accent-caption" aria-hidden="true">
  {#if selected.id === "system"}
    <strong>{selected.label}</strong> · {SYSTEM_DESCRIPTION.toLowerCase()}
  {:else}
    <strong>{selected.label}</strong>
  {/if}
</p>

<style>
  .accent-swatches {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .accent-swatch {
    display: inline-flex;
    padding: 6px;
    cursor: pointer;
  }

  .accent-circle {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--swatch-light, var(--system-accent));
    transition: box-shadow var(--motion-duration) var(--motion-easing);
  }

  .system .accent-circle {
    box-shadow: inset 0 0 0 2px
      color-mix(in srgb, var(--system-accent-text) 55%, transparent);
  }

  .system-icon {
    fill: none;
    stroke: var(--system-accent-text);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .accent-divider {
    align-self: stretch;
    width: 1px;
    margin: 10px var(--space-1);
    background: var(--color-border-strong);
  }

  input:checked + .accent-circle {
    box-shadow:
      0 0 0 2px var(--color-background),
      0 0 0 4px var(--color-text);
  }

  .system input:checked + .accent-circle {
    box-shadow:
      inset 0 0 0 2px
        color-mix(in srgb, var(--system-accent-text) 55%, transparent),
      0 0 0 2px var(--color-background),
      0 0 0 4px var(--color-text);
  }

  input:focus-visible + .accent-circle {
    outline: 2px solid var(--color-focus);
    outline-offset: 6px;
  }

  .accent-caption {
    margin: var(--space-1) 0 0 6px;
  }

  .accent-caption strong {
    color: var(--color-text);
    font-weight: 500;
  }

  @media (prefers-color-scheme: dark) {
    .accent-circle {
      background: var(--swatch-dark, var(--system-accent));
    }
  }
</style>
