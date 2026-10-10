<script lang="ts">
  import type { Snippet } from "svelte";
  import { setScreenScope } from "./screen-scope";

  interface Props {
    current: () => boolean;
    children: Snippet;
  }

  const { current, children }: Props = $props();

  setScreenScope(() => current());
</script>

{@render children()}
