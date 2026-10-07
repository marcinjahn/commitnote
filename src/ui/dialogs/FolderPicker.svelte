<script lang="ts">
  import type { NotePath } from "../../changes/change";
  import { notePathEquals } from "../../changes/change";
  import type { MoveTarget } from "./folder-options";

  interface Props {
    options: readonly MoveTarget[];
    selected: NotePath | null;
    name: string;
    onSelect: (path: NotePath) => void;
  }

  const { options, selected, name, onSelect }: Props = $props();
</script>

<div class="folder-picker" role="radiogroup" aria-label="Folder">
  {#each options as option (option.path.join("/"))}
    <label class="folder-option" class:disabled={option.disabled}>
      <input
        type="radio"
        {name}
        disabled={option.disabled}
        checked={selected !== null && notePathEquals(selected, option.path)}
        onchange={() => onSelect(option.path)}
      />
      <span
        class="folder-option-label"
        style="--depth: {option.depth}"
        title={option.path.length === 0 ? option.label : option.path.join("/")}
      >
        {option.label}
        {#if option.disabled}
          <span class="folder-option-hint">(current folder)</span>
        {/if}
      </span>
    </label>
  {/each}
</div>

<style>
  .folder-picker {
    display: grid;
    gap: var(--space-1);
  }

  .folder-option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--motion-duration) var(--motion-easing);
  }

  .folder-option:has(input:checked) {
    background: var(--color-selected);
  }

  .folder-option.disabled {
    cursor: not-allowed;
    color: var(--color-text-muted);
  }

  .folder-option:not(.disabled):hover {
    background: var(--color-hover);
  }

  .folder-option input {
    flex-shrink: 0;
    width: var(--checkbox-size);
    height: var(--checkbox-size);
  }

  .folder-option-label {
    flex: 1;
    min-width: 0;
    padding-left: calc(var(--depth, 0) * var(--space-4));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder-option-hint {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }
</style>
