<script lang="ts" generics="T extends SettingOption">
  import type { Snippet } from "svelte";
  import type { SettingOption } from "../../settings/setting-option";

  interface Props {
    readonly label: string;
    readonly name: string;
    readonly options: readonly T[];
    readonly value: string;
    readonly onSelect: (id: T["id"]) => void;
    readonly segment?: Snippet<[T]>;
    readonly describedBy?: (option: T) => string | undefined;
  }

  const { label, name, options, value, onSelect, segment, describedBy }: Props =
    $props();
</script>

<div class="segmented" role="radiogroup" aria-label={label}>
  {#each options as option (option.id)}
    <label class="segment">
      <input
        type="radio"
        class="visually-hidden"
        {name}
        value={option.id}
        checked={value === option.id}
        aria-describedby={describedBy?.(option)}
        onchange={() => onSelect(option.id)}
      />
      {#if segment}
        {@render segment(option)}
      {:else}
        {option.label}
      {/if}
    </label>
  {/each}
</div>

<style>
  .segmented {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
  }

  .segment {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: var(--touch-target);
    padding: var(--space-1) var(--space-3);
    border: var(--hairline) solid var(--color-border-strong);
    font-size: var(--font-size-sm);
    text-align: center;
    cursor: pointer;
  }

  .segment + .segment {
    margin-inline-start: calc(-1 * var(--hairline));
  }

  @media (min-width: 768px) {
    .segment {
      min-height: 32px;
    }
  }

  .segment:has(input:checked) {
    z-index: 1;
    background: var(--color-ink);
    color: var(--color-on-ink);
  }

  .segment:has(input:focus-visible) {
    z-index: 2;
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  @media (hover: hover) {
    .segment:hover:not(:has(input:checked)) {
      background: var(--color-hover);
    }
  }

  @media (forced-colors: active) {
    .segment:has(input:checked) {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  }
</style>
