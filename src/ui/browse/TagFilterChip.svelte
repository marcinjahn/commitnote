<script lang="ts">
  import { colorTagOption, colorTagStyle, type ColorTag } from "../../tags/color-tag";

  interface Props {
    tag: ColorTag;
    onClear: () => void;
  }

  const { tag, onClear }: Props = $props();
</script>

<div class="tag-filter-chip-row">
  <div class="tag-filter-chip tag-colored" style={colorTagStyle(tag)}>
    <span class="swatch" aria-hidden="true"></span>
    <span class="text">Showing: {colorTagOption(tag).label}</span>
    <button
      type="button"
      class="clear"
      aria-label="Clear color filter"
      title="Clear color filter"
      onclick={onClear}
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  </div>
</div>

<style>
  .tag-filter-chip-row {
    flex-shrink: 0;
    padding: var(--space-2) var(--space-2) 0;
  }

  .tag-filter-chip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 36px;
    padding-left: var(--space-2);
    border: var(--hairline) solid color-mix(in srgb, var(--tag-color) 55%, transparent);
    background: color-mix(in srgb, var(--tag-color) 12%, transparent);
    color: var(--color-text);
    font-size: var(--font-size-sm);
    border-radius: var(--radius-pill);
  }

  .swatch {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--tag-color);
  }

  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clear {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
      background-color var(--motion-duration) var(--motion-easing),
      color var(--motion-duration) var(--motion-easing);
  }

  .clear:hover {
    background: color-mix(in srgb, var(--tag-color) 18%, transparent);
    color: var(--color-text);
  }

  .clear:focus-visible {
    outline-offset: -2px;
  }

  @media (max-width: 767px), (pointer: coarse) {
    .tag-filter-chip {
      min-height: var(--touch-target);
    }

    .clear {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
</style>
