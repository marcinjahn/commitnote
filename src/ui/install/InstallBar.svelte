<script lang="ts">
  import type { InstallPath } from "../../app/install-offer";
  import { commandIcons } from "../browse/action-icons";
  import { dismissIcon } from "../notices/tone-icons";

  interface Props {
    variant: InstallPath;
    sideInsets?: boolean;
    onInstall: () => void;
    onDismiss: () => void;
  }

  const { variant, sideInsets = false, onInstall, onDismiss }: Props = $props();

  const text = $derived(
    variant === "prompt"
      ? "Install commitnote as an app on this device."
      : "Add commitnote to your Home Screen from the Share menu",
  );
  const label = $derived(variant === "prompt" ? "Install" : "How to install");
</script>

<section
  class="notice install-bar"
  class:side-insets={sideInsets}
  aria-label="Install app"
>
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    {#each commandIcons.install as d}<path {d} />{/each}
  </svg>
  <p class="install-bar-text">{text}</p>
  <button type="button" class="button button-primary" onclick={onInstall}>
    {label}
  </button>
  <button
    type="button"
    class="button button-icon button-ghost"
    aria-label="Dismiss install bar"
    onclick={onDismiss}
  >
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {#each dismissIcon as d}<path {d} />{/each}
    </svg>
  </button>
</section>

<style>
  .install-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
    margin: 0;
    padding: calc(var(--space-2) + env(safe-area-inset-top)) var(--space-2)
      var(--space-2) var(--space-3);
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  .install-bar.side-insets {
    padding-left: calc(var(--space-3) + env(safe-area-inset-left));
    padding-right: calc(var(--space-2) + env(safe-area-inset-right));
  }

  .install-bar-text {
    flex: 1;
    min-width: 0;
    margin: 0;
  }

  .icon {
    flex: none;
  }

  @media (forced-colors: active) {
    .install-bar {
      border-bottom: 1px solid CanvasText;
    }
  }
</style>
