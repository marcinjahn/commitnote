<script lang="ts">
  import type { SettingScope } from "../../settings/setting-scope";

  interface Props {
    label: string;
    scope: SettingScope;
    onToggle: () => void;
  }

  const { label, scope, onToggle }: Props = $props();
</script>

<button
  type="button"
  class="scope-toggle"
  aria-pressed={scope === "device"}
  aria-label="{label} only on this device"
  onclick={onToggle}
>
  {scope === "device" ? "This device" : "All devices"}
</button>

<style>
  .scope-toggle {
    flex: none;
    box-sizing: border-box;
    min-height: var(--touch-target);
    padding: 0 var(--space-2);
    border: var(--hairline) solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text-muted);
    font: inherit;
    font-size: var(--font-size-xs);
    cursor: pointer;
  }

  .scope-toggle[aria-pressed="true"] {
    color: var(--color-link);
    border-color: var(--color-accent);
  }

  .scope-toggle:focus-visible {
    outline: 2px solid var(--color-focus);
  }

  @media (min-width: 768px) {
    .scope-toggle {
      min-height: var(--control-height-compact);
      height: var(--control-height-compact);
    }
  }

  @media (hover: hover) {
    .scope-toggle:hover {
      color: var(--color-text);
    }
  }

  @media (forced-colors: active) {
    .scope-toggle[aria-pressed="true"] {
      border: 2px solid Highlight;
    }
  }
</style>
