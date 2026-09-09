<script lang="ts">
  import { actionIcons } from "./action-icons";
  import type { MenuAnchor, RowAction } from "./row-menu-types";

  interface Props {
    name: string;
    kind: "note" | "folder";
    hasFolders: boolean;
    trashes: boolean;
    anchor: MenuAnchor;
    onAction: (action: RowAction) => void;
    onClose: () => void;
    trigger: HTMLElement;
  }

  const { name, kind, hasFolders, trashes, anchor, onAction, onClose, trigger }: Props = $props();

  interface MenuItem {
    readonly action: RowAction;
    readonly label: string;
  }

  const deleteLabel = $derived(trashes ? "Move to trash…" : "Delete…");

  const allItems: readonly MenuItem[] = $derived(
    kind === "folder"
      ? [
          { action: "new-note", label: "New note…" },
          { action: "new-folder", label: "New folder…" },
          { action: "rename", label: "Rename…" },
          { action: "move", label: "Move to folder…" },
          { action: "delete", label: deleteLabel },
        ]
      : [
          { action: "move", label: "Move to folder…" },
          { action: "delete", label: deleteLabel },
        ],
  );

  const items = $derived(
    hasFolders ? allItems : allItems.filter((item) => item.action !== "move"),
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
    itemButtons()[0]?.focus();
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
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {#each actionIcons[item.action] as d (d)}
          <path {d} />
        {/each}
      </svg>
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
    transition: opacity var(--motion-duration) var(--motion-easing);
  }

  @starting-style {
    .row-menu {
      opacity: 0;
    }
  }

  .row-menu-item {
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

  .row-menu-item:hover,
  .row-menu-item:focus-visible {
    background: var(--color-hover);
  }
</style>
