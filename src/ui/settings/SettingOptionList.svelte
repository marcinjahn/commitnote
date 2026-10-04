<script lang="ts" generics="T extends SettingOption">
  import type { Snippet } from "svelte";
  import type { SettingOption } from "../../settings/setting-option";

  interface Props {
    readonly label: string;
    readonly name: string;
    readonly options: readonly T[];
    readonly value: T["id"];
    readonly onSelect: (id: T["id"]) => void;
    readonly optionLabel?: Snippet<[T]>;
    readonly columns?: 1 | 2;
    readonly onhighlight?: (kind: "hover" | "focus", id: T["id"] | null) => void;
  }

  const {
    label,
    name,
    options,
    value,
    onSelect,
    optionLabel,
    columns = 1,
    onhighlight,
  }: Props = $props();

  function handleFocusOut(event: FocusEvent): void {
    const group = event.currentTarget as HTMLElement;
    const next = event.relatedTarget;
    if (next instanceof Node && group.contains(next)) return;
    onhighlight?.("focus", null);
  }
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
  class="setting-options"
  class:two-columns={columns === 2}
  role="radiogroup"
  aria-label={label}
  onpointerleave={(event) => {
    if (event.pointerType !== "touch") onhighlight?.("hover", null);
  }}
  onfocusout={handleFocusOut}
>
  {#each options as option (option.id)}
    <label
      class="setting-option"
      onpointerenter={(event) => {
        if (event.pointerType !== "touch") onhighlight?.("hover", option.id);
      }}
    >
      <input
        type="radio"
        {name}
        value={option.id}
        checked={value === option.id}
        aria-labelledby="{name}-{option.id}-label"
        aria-describedby={option.description ? `${name}-${option.id}-description` : undefined}
        onchange={() => onSelect(option.id)}
        onfocus={() => onhighlight?.("focus", option.id)}
      />
      <span class="setting-option-text">
        <span class="setting-option-label" id="{name}-{option.id}-label" title={option.label}>
          {#if optionLabel}
            {@render optionLabel(option)}
          {:else}
            {option.label}
          {/if}
        </span>
        {#if option.description}
          <span class="setting-option-description" id="{name}-{option.id}-description">
            {option.description}
          </span>
        {/if}
      </span>
    </label>
  {/each}
</div>

<style>
  .setting-options {
    display: grid;
    gap: var(--space-1);
  }

  @media (min-width: 768px) {
    .setting-options.two-columns {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .setting-option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target);
    padding: var(--space-1) var(--space-3);
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

  .setting-option-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .setting-option-label {
    height: 1.25rem;
    line-height: 1.25rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .setting-option-description {
    font-family: var(--font-sans);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
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
