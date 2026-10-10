<script lang="ts">
  import {
    COLOR_MODE_OPTIONS,
    colorScheme,
    type ColorModeId,
  } from "../../settings/color-mode";
  import ScopeToggle from "./ScopeToggle.svelte";
  import SettingRow from "./SettingRow.svelte";
  import type { SettingsSectionProps } from "./settings-sections";

  const { settings, changeSettings, scopes, changeSettingScope }: SettingsSectionProps = $props();

  const descriptionId = $props.id();

  let osPrefersDark = $state(
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  $effect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      osPrefersDark = query.matches;
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });

  const systemDescription = $derived(
    `${colorScheme("system", osPrefersDark) === "dark" ? "Dark" : "Light"}, matches your OS`,
  );

  const selected = $derived(
    COLOR_MODE_OPTIONS.find((option) => option.id === settings.colorMode) ??
      COLOR_MODE_OPTIONS[0],
  );
</script>

{#snippet mock(scheme: "light" | "dark", half?: "start" | "end")}
  <span class="mock color-scheme-scope" data-scheme={scheme} data-half={half}>
    <span class="mock-sidebar">
      <span class="mock-row"></span>
      <span class="mock-row selected"></span>
      <span class="mock-row"></span>
    </span>
    <span class="mock-content">
      <span class="mock-line title"></span>
      <span class="mock-line"></span>
      <span class="mock-line short"></span>
      <span class="mock-line link"></span>
    </span>
  </span>
{/snippet}

<SettingRow stacked>
  {#snippet label()}Color mode{/snippet}
  {#snippet aside()}
    <ScopeToggle
      label="Color mode"
      scope={scopes.colorMode}
      onToggle={() =>
        changeSettingScope(
          "colorMode",
          scopes.colorMode === "device" ? "synced" : "device",
        )}
    />
  {/snippet}
  <div class="color-modes" role="radiogroup" aria-label="Color mode">
    {#each COLOR_MODE_OPTIONS as option (option.id)}
      {@const system = option.id === "system"}
      <label class="color-mode" title={option.label}>
        <input
          type="radio"
          class="visually-hidden"
          name="color-mode"
          value={option.id}
          aria-label={option.label}
          aria-describedby={system ? descriptionId : undefined}
          checked={settings.colorMode === option.id}
          onchange={() => changeSettings({ colorMode: option.id as ColorModeId })}
        />
        <span class="preview-card" aria-hidden="true">
          {#if system}
            {@render mock("light", "start")}
            {@render mock("dark", "end")}
            <span class="system-badge">
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path d="M2.75 3h10.5c.41 0 .75.34.75.75v6.5c0 .41-.34.75-.75.75H2.75a.75.75 0 0 1-.75-.75v-6.5c0-.41.34-.75.75-.75z" />
                <path d="M5.5 13.5h5M8 11v2.5" />
              </svg>
            </span>
          {:else}
            {@render mock(option.id === "dark" ? "dark" : "light")}
          {/if}
        </span>
        <span class="color-mode-label">{option.label}</span>
      </label>
    {/each}
  </div>
  <span id={descriptionId} class="visually-hidden">{systemDescription}</span>
  <p class="field-hint color-mode-caption" aria-hidden="true">
    {#if selected.id === "system"}
      <strong>{selected.label}</strong> · {systemDescription}
    {:else}
      <strong>{selected.label}</strong>
    {/if}
  </p>
</SettingRow>

<style>
  .color-modes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .color-mode {
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
    transition:
      transform var(--motion-duration) var(--motion-easing),
      box-shadow var(--motion-duration) var(--motion-easing);
  }

  @media (hover: hover) {
    .color-mode:hover .preview-card {
      transform: translateY(-2px);
      box-shadow: var(--shadow-2);
    }
  }

  input:checked + .preview-card {
    box-shadow:
      0 0 0 2px var(--color-background),
      0 0 0 4px var(--color-text);
  }

  @media (hover: hover) {
    .color-mode:hover input:checked + .preview-card {
      box-shadow:
        0 0 0 2px var(--color-background),
        0 0 0 4px var(--color-text),
        var(--shadow-2);
    }
  }

  input:focus-visible + .preview-card {
    outline: 2px solid var(--color-focus);
    outline-offset: 6px;
  }

  .mock {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: 32% 1fr;
    background: var(--color-background);
  }

  .mock[data-scheme="light"] {
    color-scheme: light;
  }

  .mock[data-scheme="dark"] {
    color-scheme: dark;
  }

  .mock[data-half="end"] {
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
  }

  .mock[data-half="start"] {
    clip-path: polygon(0 0, 100% 0, 0 100%);
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
    position: relative;
    height: 7px;
    background: var(--color-text-muted);
    opacity: 0.45;
  }

  .mock-row.selected {
    background: var(--color-selected-accent);
    opacity: 1;
    box-shadow: inset 2px 0 0 var(--color-accent);
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

  .mock-line.link {
    width: 40%;
    background: var(--color-accent);
    opacity: 1;
  }

  .system-badge {
    position: absolute;
    right: 6px;
    top: 6px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--color-ink);
  }

  .system-badge svg {
    fill: none;
    stroke: var(--color-on-ink);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .color-mode-label {
    font-size: var(--font-size-sm);
    color: var(--color-text);
  }

  .color-mode-caption {
    margin: var(--space-2) 0 0;
  }

  .color-mode-caption strong {
    color: var(--color-text);
    font-weight: 500;
  }

  @media (forced-colors: active) {
    .preview-card,
    .preview-card * {
      forced-color-adjust: none;
    }

    .preview-card {
      box-shadow: 0 0 0 1px CanvasText;
    }

    input:checked + .preview-card {
      box-shadow:
        0 0 0 2px Canvas,
        0 0 0 4px Highlight;
    }
  }

  @media (forced-colors: active) and (hover: hover) {
    .color-mode:hover .preview-card {
      box-shadow: 0 0 0 1px CanvasText;
    }

    .color-mode:hover input:checked + .preview-card {
      box-shadow:
        0 0 0 2px Canvas,
        0 0 0 4px Highlight;
    }
  }
</style>
