<script lang="ts">
  import {
    colorTagOption,
    colorTagStyle,
    type ColorTag,
  } from "../../tags/color-tag";
  import { filterIcon } from "./action-icons";
  import MenuPopup from "./MenuPopup.svelte";
  import type { MenuAnchor, MenuRadioGroup } from "./row-menu-types";

  interface Props {
    tags: readonly ColorTag[];
    active: ColorTag | null;
    onChange: (tag: ColorTag | null) => void;
  }

  const { tags, active, onChange }: Props = $props();

  const LABEL = "Filter by color";
  const ALL = "all";

  let button: HTMLButtonElement | undefined = $state();
  let anchor = $state<MenuAnchor | null>(null);

  const name = $derived(
    active === null ? LABEL : `${LABEL}: ${colorTagOption(active).label}`,
  );

  const radios: MenuRadioGroup = $derived({
    label: LABEL,
    options: [
      { id: ALL, label: "All notes", swatch: null },
      ...tags.map((tag) => ({ id: tag, label: colorTagOption(tag).label, swatch: tag })),
    ],
    selected: active ?? ALL,
    onPick: pick,
  });

  export function focus(): void {
    button?.focus();
  }

  function toggle(): void {
    if (button === undefined) return;
    anchor =
      anchor === null ? { kind: "rect", rect: button.getBoundingClientRect() } : null;
  }

  function close(): void {
    anchor = null;
    button?.focus();
  }

  function pick(id: string): void {
    close();
    onChange(id === ALL ? null : (tags.find((tag) => tag === id) ?? null));
  }
</script>

<button
  type="button"
  class="button button-icon tag-filter-button"
  class:tag-colored={active !== null}
  class:filtering={active !== null}
  style={active === null ? undefined : colorTagStyle(active)}
  bind:this={button}
  aria-label={name}
  title={name}
  aria-haspopup="menu"
  aria-expanded={anchor !== null}
  onclick={toggle}
>
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    {#each filterIcon as d (d)}
      <path {d} />
    {/each}
  </svg>
  {#if active !== null}
    <span class="tag-filter-dot"></span>
  {/if}
</button>

{#if anchor !== null && button !== undefined}
  <MenuPopup
    label={LABEL}
    items={[]}
    {radios}
    {anchor}
    trigger={button}
    onSelect={() => {}}
    onClose={close}
  />
{/if}

<style>
  .tag-filter-button {
    position: relative;
    flex-shrink: 0;
    border: var(--hairline) solid var(--color-border);
    background: transparent;
    color: var(--color-text-muted);
    transition:
      background-color var(--motion-duration) var(--motion-easing),
      border-color var(--motion-duration) var(--motion-easing),
      color var(--motion-duration) var(--motion-easing);
  }

  .tag-filter-button:hover,
  .tag-filter-button[aria-expanded="true"] {
    background: var(--color-hover);
    border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
    color: var(--color-text);
  }

  .tag-filter-button.filtering {
    background: color-mix(in srgb, var(--tag-color) 14%, transparent);
    border-color: color-mix(in srgb, var(--tag-color) 55%, transparent);
    color: var(--color-text);
  }

  .tag-filter-button.filtering:hover,
  .tag-filter-button.filtering[aria-expanded="true"] {
    background: color-mix(in srgb, var(--tag-color) 22%, transparent);
  }

  .tag-filter-dot {
    position: absolute;
    top: calc(50% - 9px);
    left: calc(50% + 4px);
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tag-color);
    box-shadow: 0 0 0 2px var(--color-surface);
  }
</style>
