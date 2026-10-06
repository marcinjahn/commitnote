<script lang="ts">
  import { colorTagStyle, type ColorTag } from "../../tags/color-tag";

  interface Props {
    colorTag: ColorTag | null;
    muted?: boolean;
  }

  const { colorTag, muted = false }: Props = $props();
</script>

<svg
  class="icon note-icon"
  class:muted
  class:tag-colored={colorTag !== null}
  style={colorTag !== null ? colorTagStyle(colorTag) : undefined}
  viewBox="0 0 16 16"
  aria-hidden="true"
  focusable="false"
>
  <path class="note-icon-page" d="M3.5 1.5h6l3 3v10h-9z" />
  <path d="M9.5 1.5v3h3" />
</svg>

<style>
  .note-icon {
    flex-shrink: 0;
    transition: color var(--motion-duration) var(--motion-easing);
  }

  .note-icon.muted {
    color: var(--color-text-muted);
  }

  .note-icon.tag-colored {
    color: var(--tag-color);
  }

  .note-icon-page {
    transition:
      fill var(--motion-duration) var(--motion-easing),
      stroke var(--motion-duration) var(--motion-easing);
  }

  .tag-colored .note-icon-page {
    fill: color-mix(in srgb, var(--tag-color) 20%, transparent);
  }
</style>
