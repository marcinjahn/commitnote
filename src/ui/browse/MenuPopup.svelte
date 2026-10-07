<script lang="ts" generics="Id extends string">
  import { COLOR_TAG_PALETTE, colorTagStyle, type ColorTag } from "../../tags/color-tag";
  import type { MenuAnchor, MenuItem, MenuRadioGroup } from "./row-menu-types";

  interface Props {
    label: string;
    items: readonly MenuItem<Id>[];
    anchor: MenuAnchor;
    trigger: HTMLElement;
    swatches?: {
      selected: ColorTag | null;
      disabled: boolean;
      onPick: (color: ColorTag | null) => void;
    };
    radios?: MenuRadioGroup;
    onSelect: (id: Id) => void;
    onClose: () => void;
  }

  const { label, items, anchor, trigger, swatches, radios, onSelect, onClose }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state();
  let position = $state({ top: -9999, left: -9999 });

  function itemButtons(): HTMLButtonElement[] {
    const el = menuEl;
    if (el === undefined) return [];
    return Array.from(
      el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)'),
    );
  }

  // Position after mount, once the popup's own size is known, then clamp it
  // to the viewport so it never opens off-screen. offsetWidth/offsetHeight
  // ignore the entrance transform, which is still applied at this point.
  $effect(() => {
    const el = menuEl;
    if (el === undefined) return;
    const rect = { width: el.offsetWidth, height: el.offsetHeight };
    const margin = 8;
    const rawTop =
      anchor.kind === "rect" ? anchor.rect.bottom + 4 : anchor.y;
    const rawLeft =
      anchor.kind === "rect" ? anchor.rect.right - rect.width : anchor.x;
    position = {
      top: Math.round(
        Math.min(
          Math.max(margin, rawTop),
          window.innerHeight - rect.height - margin,
        ),
      ),
      left: Math.round(
        Math.min(
          Math.max(margin, rawLeft),
          window.innerWidth - rect.width - margin,
        ),
      ),
    };
  });

  $effect(() => {
    const buttons = itemButtons();
    const checked = buttons.find((button) => button.getAttribute("aria-checked") === "true");
    (checked ?? buttons[0])?.focus();
  });

  $effect(() => {
    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as Node;
      if (menuEl?.contains(target) || trigger.contains(target)) return;
      onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      onClose();
      return;
    }
    const buttons = itemButtons();
    if (buttons.length === 0) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const row = Array.from(
        menuEl?.querySelectorAll<HTMLButtonElement>(
          '.menu-swatches [role="menuitemradio"]:not(:disabled)',
        ) ?? [],
      );
      const index = row.findIndex((button) => button === document.activeElement);
      if (index === -1) return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      row[(index + delta + row.length) % row.length]?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const current = buttons.findIndex((button) => button === document.activeElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const base = current === -1 ? (delta > 0 ? 0 : -1) : current + delta;
    const next = ((base % buttons.length) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
</script>

<div
  bind:this={menuEl}
  class="menu-popup"
  data-anchor={anchor.kind}
  role="menu"
  tabindex="-1"
  aria-label={label}
  style="top: {position.top}px; left: {position.left}px;"
  onkeydown={handleKeydown}
>
  {#if swatches !== undefined}
    <div role="group" aria-label="Color tag" class="menu-swatches">
      {#each COLOR_TAG_PALETTE as option (option.id)}
        <button
          type="button"
          role="menuitemradio"
          class="menu-swatch"
          aria-checked={swatches.selected === option.id}
          aria-label={option.label}
          disabled={swatches.disabled}
          onclick={() => swatches.onPick(option.id)}
        >
          <span class="swatch-circle tag-colored" style={colorTagStyle(option.id)}></span>
        </button>
      {/each}
      <button
        type="button"
        role="menuitemradio"
        class="menu-swatch"
        aria-checked={swatches.selected === null}
        aria-label="No color"
        disabled={swatches.disabled}
        onclick={() => swatches.onPick(null)}
      >
        <span class="swatch-circle swatch-none">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M5 15 15 5" />
          </svg>
        </span>
      </button>
    </div>
  {/if}
  {#if radios !== undefined}
    <div role="group" aria-label={radios.label}>
      {#each radios.options as option (option.id)}
        <button
          type="button"
          role="menuitemradio"
          class="menu-popup-item menu-radio"
          aria-checked={option.id === radios.selected}
          onclick={() => radios.onPick(option.id)}
        >
          {#if option.swatch === null}
            <span class="swatch-circle swatch-hollow"></span>
          {:else}
            <span class="swatch-circle tag-colored" style={colorTagStyle(option.swatch)}></span>
          {/if}
          <span class="menu-radio-label">{option.label}</span>
          <svg class="menu-radio-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3 8.5 6.5 12 13 4.5" />
          </svg>
        </button>
      {/each}
    </div>
  {/if}
  {#each items as item (item.id)}
    <button
      type="button"
      role="menuitem"
      class="menu-popup-item"
      class:destructive={item.destructive === true}
      disabled={item.disabled === true}
      onclick={() => onSelect(item.id)}
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {#each item.icon as d (d)}
          <path {d} />
        {/each}
      </svg>
      {item.label}
    </button>
  {/each}
</div>

<style>
  .menu-popup {
    position: fixed;
    z-index: 20;
    display: flex;
    flex-direction: column;
    min-width: var(--menu-min-width);
    --menu-padding-block: var(--space-1);
    --menu-edge-radius: max(
      var(--floating-item-radius),
      calc(var(--floating-radius) - var(--menu-padding-block))
    );
    padding: var(--menu-padding-block) var(--floating-item-inset);
    border-radius: var(--floating-radius);
    border: var(--floating-border);
    background-color: var(--floating-background);
    background-image: var(--floating-texture);
    -webkit-backdrop-filter: var(--floating-backdrop);
    backdrop-filter: var(--floating-backdrop);
    box-shadow: var(--floating-edge-highlight), var(--floating-shadow);
    transition:
      opacity var(--floating-enter-duration) var(--floating-enter-easing),
      transform var(--floating-enter-duration) var(--floating-enter-easing);
  }

  .menu-popup[data-anchor="rect"] {
    transform-origin: top right;
  }

  .menu-popup[data-anchor="point"] {
    transform-origin: top left;
  }

  @starting-style {
    .menu-popup {
      opacity: 0;
      transform: var(--floating-enter-transform);
    }
  }

  .menu-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
  }

  .menu-swatch {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
  }

  @media (pointer: coarse) {
    .menu-swatch {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }

  .menu-swatch:disabled {
    cursor: default;
    opacity: 0.4;
  }

  .menu-swatch:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 0;
  }

  .swatch-circle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--tag-color);
    transition:
      background-color var(--motion-duration) var(--motion-easing),
      box-shadow var(--motion-duration) var(--motion-easing);
  }

  .swatch-none {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--color-text-muted);
  }

  .swatch-none svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  .menu-swatch[aria-checked="true"] .swatch-circle {
    box-shadow:
      0 0 0 2px var(--color-surface-raised),
      0 0 0 4px var(--color-text);
  }

  .menu-swatch[aria-checked="true"] .swatch-none {
    box-shadow:
      inset 0 0 0 1.5px var(--color-text-muted),
      0 0 0 2px var(--color-surface-raised),
      0 0 0 4px var(--color-text);
  }

  .menu-popup-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border: none;
    border-radius: var(--floating-item-radius);
    background: transparent;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    font-size: var(--font-size-sm);
    transition: background-color var(--motion-duration) var(--motion-easing);
  }

  .swatch-hollow {
    background: transparent;
    box-shadow: inset 0 0 0 var(--hairline) var(--color-text-muted);
  }

  .menu-radio {
    width: 100%;
  }

  .menu-radio-label {
    flex: 1;
  }

  .menu-radio-check {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    visibility: hidden;
  }

  .menu-radio[aria-checked="true"] .menu-radio-check {
    visibility: visible;
  }

  .menu-popup > .menu-popup-item:first-child,
  .menu-popup > :first-child > .menu-popup-item:first-child {
    border-top-left-radius: var(--menu-edge-radius);
    border-top-right-radius: var(--menu-edge-radius);
  }

  .menu-popup > .menu-popup-item:last-child,
  .menu-popup > :last-child > .menu-popup-item:last-child {
    border-bottom-left-radius: var(--menu-edge-radius);
    border-bottom-right-radius: var(--menu-edge-radius);
  }

  .menu-popup-item:hover:not(:disabled),
  .menu-popup-item:focus-visible {
    background: var(--floating-highlight);
  }

  .menu-popup-item:focus-visible {
    outline-offset: -2px;
  }

  @media (pointer: fine) {
    .menu-popup-item {
      min-height: var(--floating-item-height-fine);
    }
  }

  @media (forced-colors: active) {
    .menu-popup-item:hover:not(:disabled),
    .menu-popup-item:focus-visible {
      color: HighlightText;
    }
  }

  .menu-popup-item.destructive {
    color: var(--color-danger);
  }

  .menu-popup-item:disabled {
    color: var(--color-text-muted);
    cursor: default;
  }
</style>
