<script lang="ts">
  import type { PlacementOption } from "../../settings/placement-options";

  interface Props {
    readonly label: string;
    readonly name: string;
    readonly options: readonly PlacementOption[];
    readonly value: string;
    readonly onSelect: (id: string) => void;
  }

  const { label, name, options, value, onSelect }: Props = $props();
</script>

<div class="setting-options" role="radiogroup" aria-label={label}>
  {#each options as option (option.id)}
    <label class="setting-option">
      <input
        type="radio"
        {name}
        value={option.id}
        checked={value === option.id}
        onchange={() => onSelect(option.id)}
      />
      <span>{option.label}</span>
    </label>
  {/each}
</div>

<style>
  .setting-options {
    display: grid;
    gap: var(--space-1);
  }

  .setting-option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border-radius: var(--radius);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--motion-duration) var(--motion-easing);
  }

  .setting-option:has(input:checked) {
    background: var(--color-selected);
  }

  .setting-option:hover {
    background: var(--color-hover);
  }

  input {
    flex-shrink: 0;
    width: var(--checkbox-size);
    height: var(--checkbox-size);
  }

  input:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
