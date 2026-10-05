<script lang="ts" generics="Id extends string">
  import { COLOR_TAG_PALETTE, colorTagStyle, type ColorTag } from "../../tags/color-tag";
  import type { MenuAnchor, MenuItem } from "./row-menu-types";

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
    onSelect: (id: Id) => void;
    onClose: () => void;
  }

  const { label, items, anchor, trigger, swatches, onSelect, onClose }: Props = $props();

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
  // to the viewport so it never opens off-screen.
  $effect(() => {
    const el = menuEl;
    if (el === undefined) return;
    const rect = el.getBoundingClientRect();
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
  {#each items as item (item.id)}
    <button
      type="button"
      role="menuitem"
      class="menu-popup-item"
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
    padding: var(--space-1) 0;
    border-radius: var(--radius);
    border: var(--hairline) solid var(--color-border);
    background: var(--color-surface-raised);
    box-shadow: var(--shadow-1);
    transition: opacity var(--motion-duration) var(--motion-easing);
  }

  @starting-style {
    .menu-popup {
      opacity: 0;
    }
  }

  .menu-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
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
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    font-size: var(--font-size-sm);
    transition: background-color var(--motion-duration) var(--motion-easing);
  }

  .menu-popup-item:hover:not(:disabled),
  .menu-popup-item:focus-visible {
    background: var(--color-hover);
  }

  .menu-popup-item:disabled {
    color: var(--color-text-muted);
    cursor: default;
  }
</style>
