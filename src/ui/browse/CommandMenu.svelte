<script lang="ts">
  import MenuPopup from "./MenuPopup.svelte";
  import type { Command, MenuAnchor } from "./row-menu-types";

  interface Props {
    commands: readonly Command[];
  }

  const { commands }: Props = $props();

  let button: HTMLButtonElement | undefined = $state();
  let anchor = $state<MenuAnchor | null>(null);

  function toggle(): void {
    if (button === undefined) return;
    anchor =
      anchor === null ? { kind: "rect", rect: button.getBoundingClientRect() } : null;
  }

  function close(): void {
    anchor = null;
    button?.focus();
  }

  function handleSelect(id: string): void {
    const command = commands.find((entry) => entry.id === id);
    close();
    command?.run();
  }
</script>

<button
  type="button"
  class="button button-icon button-ghost"
  bind:this={button}
  aria-label="More commands"
  aria-haspopup="menu"
  aria-expanded={anchor !== null}
  onclick={toggle}
>
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="3.5" r="1.25" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
    <circle cx="8" cy="12.5" r="1.25" fill="currentColor" stroke="none" />
  </svg>
</button>

{#if anchor !== null && button !== undefined}
  <MenuPopup
    label="Commands"
    items={commands}
    {anchor}
    trigger={button}
    onSelect={handleSelect}
    onClose={close}
  />
{/if}
