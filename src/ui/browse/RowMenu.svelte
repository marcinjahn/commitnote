<script lang="ts">
  import type { MenuAnchor, RowAction } from "./row-menu-types";

  interface Props {
    name: string;
    kind: "note" | "folder";
    anchor: MenuAnchor;
    onAction: (action: RowAction) => void;
    onClose: () => void;
  }

  const { name, kind, anchor, onAction, onClose }: Props = $props();

  interface MenuItem {
    readonly action: RowAction;
    readonly label: string;
  }

  const items: readonly MenuItem[] = $derived(
    kind === "folder"
      ? [
          { action: "new-note", label: "New note…" },
          { action: "new-folder", label: "New folder…" },
          { action: "rename", label: "Rename…" },
          { action: "move", label: "Move to folder…" },
          { action: "delete", label: "Delete…" },
        ]
      : [
          { action: "move", label: "Move to folder…" },
          { action: "delete", label: "Delete…" },
        ],
  );

  let menuEl: HTMLDivElement | undefined = $state();
  let position = $state({ top: -9999, left: -9999 });

  function itemButtons(): HTMLButtonElement[] {
    const el = menuEl;
    if (el === undefined) return [];
    return Array.from(
      el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
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
      top: Math.min(
        Math.max(margin, rawTop),
        window.innerHeight - rect.height - margin,
      ),
      left: Math.min(
        Math.max(margin, rawLeft),
        window.innerWidth - rect.width - margin,
      ),
    };
  });

  $effect(() => {
    itemButtons()[0]?.focus();
  });

  $effect(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (menuEl?.contains(event.target as Node)) return;
      onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = itemButtons();
    if (buttons.length === 0) return;
    const current = buttons.findIndex((button) => button === document.activeElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const base = current === -1 ? (delta > 0 ? 0 : -1) : current + delta;
    const next = ((base % buttons.length) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
</script>

<div
  bind:this={menuEl}
  class="row-menu"
  role="menu"
  tabindex="-1"
  aria-label={`Actions for ${name}`}
  style="top: {position.top}px; left: {position.left}px;"
  onkeydown={handleKeydown}
>
  {#each items as item (item.action)}
    <button
      type="button"
      role="menuitem"
      class="row-menu-item"
      onclick={() => onAction(item.action)}
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  .row-menu {
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
    transition:
      opacity var(--motion-duration) var(--motion-easing),
      transform var(--motion-duration) var(--motion-easing);
  }

  @starting-style {
    .row-menu {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  .row-menu-item {
    display: flex;
    align-items: center;
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

  .row-menu-item:hover,
  .row-menu-item:focus-visible {
    background: var(--color-hover);
  }
</style>
