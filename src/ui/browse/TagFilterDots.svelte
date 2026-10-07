<script lang="ts">
  import { colorTagStyle, type ColorTag } from "../../tags/color-tag";
  import { describeColorTag } from "./tag-messages";

  interface Props {
    tags: readonly ColorTag[];
    active: ColorTag | null;
    onToggle: (tag: ColorTag) => void;
  }

  const { tags, active, onToggle }: Props = $props();
</script>

<div class="tag-filter" role="group" aria-label="Tag filter">
  {#each tags as tag (tag)}
    <button
      type="button"
      class="tag-filter-dot"
      aria-pressed={tag === active}
      aria-label={`Filter by ${describeColorTag(tag)}`}
      title={`Filter by ${describeColorTag(tag)}`}
      onclick={() => onToggle(tag)}
    >
      <span class="swatch-circle tag-colored" style={colorTagStyle(tag)}></span>
    </button>
  {/each}
</div>

<style>
  .tag-filter {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: 0 var(--space-2);
  }

  .tag-filter-dot {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
  }

  @media (pointer: coarse), (max-width: 600px) {
    .tag-filter-dot {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }

  .tag-filter-dot:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 0;
  }

  .swatch-circle {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--tag-color);
    transition: box-shadow var(--motion-duration) var(--motion-easing);
  }

  .tag-filter-dot[aria-pressed="true"] .swatch-circle {
    box-shadow:
      0 0 0 2px var(--color-surface-raised),
      0 0 0 4px var(--color-text);
  }
</style>
