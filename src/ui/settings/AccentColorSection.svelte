<script lang="ts">
  import {
    ACCENT_PALETTE,
    accentOption,
    type AccentOption,
  } from "../../settings/accent-palette";
  import { getStandalone } from "../standalone-context";
  import { systemAccent } from "../system-accent.svelte";
  import ScopeToggle from "./ScopeToggle.svelte";
  import SettingRow from "./SettingRow.svelte";
  import { describeSystemAccent } from "./settings-messages";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings, scopes, changeSettingScope }: SettingsSectionProps = $props();

  const standalone = getStandalone();
  const descriptionId = $props.id();

  const systemOption = $derived(accentOption(systemAccent().id));
  const systemDescription = $derived(
    describeSystemAccent({
      label: systemOption.label,
      fromOs: systemAccent().fromOs,
      standalone,
    }),
  );

  const selected = $derived(accentOption(settings.accentColor));

  function swatchStyle(option: AccentOption): string | undefined {
    if (option.light === undefined || option.dark === undefined) {
      return undefined;
    }
    return `--swatch-light: ${option.light}; --swatch-dark: ${option.dark}`;
  }
</script>

<SettingRow stacked>
  {#snippet label()}Accent color{/snippet}
  {#snippet aside()}
    <ScopeToggle
      label="Accent color"
      scope={scopes.accentColor}
      onToggle={() =>
        changeSettingScope(
          "accentColor",
          scopes.accentColor === "device" ? "synced" : "device",
        )}
    />
  {/snippet}
  <div class="accent-picker">
    <div
      class="accent-swatches"
      role="radiogroup"
      aria-label="Accent color"
      style="--swatch-count: {ACCENT_PALETTE.length - 1}; --swatch-columns: {Math.ceil((ACCENT_PALETTE.length - 1) / 2)}"
    >
      {#each ACCENT_PALETTE as option (option.id)}
        {@const system = option.id === "system"}
        <label
          class="accent-swatch"
          class:system
          title={system ? `${option.label}: ${systemDescription}` : option.label}
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
          <span class="accent-square" style={swatchStyle(system ? systemOption : option)}>
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
  </div>
  <span id={descriptionId} class="visually-hidden">{systemDescription}</span>
  <p class="field-hint accent-caption" aria-hidden="true">
    {#if selected.id === "system"}
      <strong>{selected.label}</strong> · {systemDescription}
    {:else}
      <strong>{selected.label}</strong>
    {/if}
  </p>
</SettingRow>

<style>
  .accent-swatches {
    display: grid;
    grid-template-columns: auto auto repeat(var(--swatch-columns), auto);
    justify-content: start;
    align-items: center;
    gap: 0 var(--space-1);
  }

  .system,
  .accent-divider {
    grid-row: span 2;
  }

  .accent-picker {
    container-type: inline-size;
  }

  @container (min-width: 34rem) {
    .accent-swatches {
      grid-template-columns: auto auto repeat(var(--swatch-count), auto);
      justify-content: space-between;
    }

    .system,
    .accent-divider {
      grid-row: auto;
    }
  }

  .accent-swatch {
    display: inline-flex;
    padding: 6px;
    cursor: pointer;
  }

  @media (max-width: 767px) {
    .accent-swatch {
      box-sizing: border-box;
      min-width: var(--touch-target);
      min-height: var(--touch-target);
      align-items: center;
      justify-content: center;
    }
  }

  .accent-square {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    background: light-dark(var(--swatch-light), var(--swatch-dark));
    transition: box-shadow var(--motion-duration) var(--motion-easing);
  }

  .system .accent-square {
    box-shadow: inset 0 0 0 2px
      color-mix(in srgb, var(--color-on-accent) 55%, transparent);
  }

  .system-icon {
    fill: none;
    stroke: var(--color-on-accent);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .accent-divider {
    align-self: stretch;
    width: var(--hairline);
    margin: 10px var(--space-1);
    background: var(--color-border-strong);
  }

  input:checked + .accent-square {
    box-shadow:
      0 0 0 2px var(--color-background),
      0 0 0 4px var(--color-text);
  }

  .system input:checked + .accent-square {
    box-shadow:
      inset 0 0 0 2px
        color-mix(in srgb, var(--color-on-accent) 55%, transparent),
      0 0 0 2px var(--color-background),
      0 0 0 4px var(--color-text);
  }

  input:focus-visible + .accent-square {
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

  @media (forced-colors: active) {
    .accent-square {
      forced-color-adjust: none;
      box-shadow: 0 0 0 1px CanvasText;
    }

    .system .accent-square {
      box-shadow:
        0 0 0 1px CanvasText,
        inset 0 0 0 2px
          color-mix(in srgb, var(--color-on-accent) 55%, transparent);
    }

    input:checked + .accent-square {
      box-shadow:
        0 0 0 2px Canvas,
        0 0 0 4px Highlight;
    }

    .system input:checked + .accent-square {
      box-shadow:
        0 0 0 2px Canvas,
        0 0 0 4px Highlight,
        inset 0 0 0 2px
          color-mix(in srgb, var(--color-on-accent) 55%, transparent);
    }
  }
</style>
