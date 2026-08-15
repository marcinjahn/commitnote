<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    open: boolean;
    title: string;
    onClose: () => void;
    children: Snippet;
    actions?: Snippet;
  }

  const { open, title, onClose, children, actions }: Props = $props();

  const uid = $props.id();
  const titleId = `dialog-title-${uid}`;

  let dialogEl: HTMLDialogElement | undefined = $state();

  function focusInitialElement(el: HTMLDialogElement): void {
    const field = el.querySelector<HTMLElement>(
      "input:not(:disabled), textarea:not(:disabled), select:not(:disabled)",
    );
    const target = field ?? el.querySelector<HTMLElement>("button:not(:disabled)");
    target?.focus();
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      target.select();
    }
  }

  $effect(() => {
    const el = dialogEl;
    if (el === undefined) return;
    if (open) {
      if (!el.open) {
        el.showModal();
      }
      focusInitialElement(el);
    } else if (el.open) {
      el.close();
    }
  });

  function handleCancel(event: Event): void {
    event.preventDefault();
    onClose();
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialogEl) {
      onClose();
    }
  }
</script>

<dialog
  bind:this={dialogEl}
  class="dialog"
  aria-labelledby={titleId}
  oncancel={handleCancel}
  onclick={handleBackdropClick}
>
  <div class="dialog-card">
    <h2 id={titleId} class="dialog-title">{title}</h2>
    <div class="dialog-body">
      {@render children()}
    </div>
    {#if actions}
      <div class="dialog-actions">
        {@render actions()}
      </div>
    {/if}
  </div>
</dialog>

<style>
  .dialog {
    position: fixed;
    inset: auto 0 0 0;
    margin: 0;
    width: 100%;
    max-width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }

  .dialog-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-height: 90dvh;
    overflow: hidden;
    background: var(--color-surface-raised);
    color: var(--color-text);
    box-shadow: var(--shadow-raised);
    border-radius: var(--radius) var(--radius) 0 0;
    padding: var(--space-4);
    padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
  }

  .dialog-title {
    margin: 0;
  }

  .dialog-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  @media (min-width: 768px) {
    .dialog {
      position: fixed;
      inset: 0;
      margin: auto;
      width: auto;
      max-width: 28rem;
    }

    .dialog-card {
      max-height: 80dvh;
      border-radius: var(--radius);
      padding-bottom: var(--space-4);
    }
  }
</style>
