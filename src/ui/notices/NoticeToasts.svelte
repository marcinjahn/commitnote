<script lang="ts">
  import type { NotePath } from "../../changes/change";
  import type { EngineNotice } from "../../sync/sync-engine";
  import { describeNotice } from "./notice-messages";

  interface Props {
    notices: readonly EngineNotice[];
    onDismiss: (id: number) => void;
    onOpen?: (path: NotePath) => void;
  }

  const { notices, onDismiss, onOpen }: Props = $props();

  const MAX_VISIBLE = 3;
  const AUTO_DISMISS_MS = 10_000;

  const visible = $derived(notices.slice(-MAX_VISIBLE));
  let pausedIds = $state<ReadonlySet<number>>(new Set());
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  $effect(() => {
    const active = new Set<number>();
    for (const notice of visible) {
      if (!pausedIds.has(notice.id)) active.add(notice.id);
    }
    for (const [id, timer] of timers) {
      if (!active.has(id)) {
        clearTimeout(timer);
        timers.delete(id);
      }
    }
    for (const id of active) {
      if (timers.has(id)) continue;
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          onDismiss(id);
        }, AUTO_DISMISS_MS),
      );
    }
  });

  $effect(() => {
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  });

  function pause(id: number): void {
    if (pausedIds.has(id)) return;
    pausedIds = new Set(pausedIds).add(id);
  }

  function resume(id: number): void {
    if (!pausedIds.has(id)) return;
    const next = new Set(pausedIds);
    next.delete(id);
    pausedIds = next;
  }

  function handleFocusOut(event: FocusEvent, id: number): void {
    const toast = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && toast.contains(event.relatedTarget)) {
      return;
    }
    resume(id);
  }

  function handleOpen(notice: Extract<EngineNotice, { kind: "conflict" }>): void {
    onOpen?.(notice.path);
    onDismiss(notice.id);
  }
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each visible as notice (notice.id)}
    <div
      class="toast"
      role="group"
      onmouseenter={() => pause(notice.id)}
      onmouseleave={() => resume(notice.id)}
      onfocusin={() => pause(notice.id)}
      onfocusout={(event) => handleFocusOut(event, notice.id)}
    >
      <p class="text">{describeNotice(notice)}</p>
      <div class="actions">
        {#if notice.kind === "conflict" && onOpen}
          <button type="button" class="button" onclick={() => handleOpen(notice)}>
            Open note
          </button>
        {/if}
        <button
          type="button"
          class="button"
          aria-label="Dismiss notice"
          onclick={() => onDismiss(notice.id)}
        >
          Dismiss
        </button>
      </div>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    z-index: 50;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3)
      calc(var(--space-2) + env(safe-area-inset-bottom, 0px));
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-raised);
  }

  .text {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .actions .button {
    min-height: var(--touch-target);
  }

  @media (min-width: 768px) {
    .toasts {
      left: auto;
      width: 380px;
      max-width: 100%;
      padding-right: var(--space-3);
      padding-bottom: var(--space-3);
    }
  }
</style>
