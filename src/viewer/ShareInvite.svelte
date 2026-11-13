<script lang="ts">
  import {
    SHARE_INVITE_DISMISS_LABEL,
    SHARE_INVITE_LABEL,
    SHARE_INVITE_LINK_LABEL,
    SHARE_INVITE_TEXT,
  } from "./viewer-messages";

  interface Props {
    landingUrl: string;
    onDismiss: () => void;
  }

  const { landingUrl, onDismiss }: Props = $props();
</script>

<aside class="share-invite" aria-label={SHARE_INVITE_LABEL}>
  <div class="body">
    <p class="text">{SHARE_INVITE_TEXT}</p>
    <div class="actions">
      <a href={landingUrl} target="_blank" rel="noopener noreferrer"
        >{SHARE_INVITE_LINK_LABEL}</a
      >
      <button class="link-button dismiss" type="button" onclick={onDismiss}
        >{SHARE_INVITE_DISMISS_LABEL}</button
      >
    </div>
  </div>
</aside>

<style>
  .share-invite {
    width: 100%;
    max-width: var(--content-max-width);
    margin: 0 auto;
    padding: 0 var(--space-4) var(--space-3);
    box-sizing: border-box;
  }

  .body {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: var(--hairline) solid var(--color-border);
  }

  .text {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-4);
    font-size: var(--font-size-sm);
  }

  .dismiss {
    color: var(--color-text-muted);
  }

  @media (pointer: coarse) {
    .actions a,
    .actions button {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
      min-width: var(--touch-target);
    }
  }
</style>
