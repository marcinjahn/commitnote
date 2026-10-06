<script lang="ts">
  import type { NotePath } from "../../changes/change";
  import type { EngineNotice } from "../../sync/sync-engine";
  import {
    describeNotice,
    noticeTone,
    toneLabel,
    type ToastMessage,
    type ToastTone,
  } from "./notice-messages";

  interface Props {
    notices: readonly EngineNotice[];
    messages?: readonly ToastMessage[];
    onDismiss: (id: number) => void;
    onDismissMessage?: (id: number) => void;
    onOpen?: (path: NotePath) => void;
  }

  const { notices, messages = [], onDismiss, onDismissMessage, onOpen }: Props =
    $props();

  const MAX_VISIBLE = 3;
  const AUTO_DISMISS_MS = 10_000;

  interface Toast {
    readonly key: string;
    readonly tone: ToastTone;
    readonly text: string;
    readonly conflict: Extract<EngineNotice, { kind: "conflict" }> | null;
    readonly action: ToastMessage["action"] | undefined;
    readonly durationMs: number;
    readonly dismiss: () => void;
  }

  const visible = $derived<readonly Toast[]>(
    [
      ...notices.map((notice) => ({
        key: `notice-${notice.id}`,
        tone: noticeTone(notice),
        text: describeNotice(notice),
        conflict: notice.kind === "conflict" ? notice : null,
        action: undefined,
        durationMs: AUTO_DISMISS_MS,
        dismiss: () => onDismiss(notice.id),
      })),
      ...messages.map((message) => ({
        key: `message-${message.id}`,
        tone: message.tone,
        text: message.text,
        conflict: null,
        action: message.action,
        durationMs: message.durationMs ?? AUTO_DISMISS_MS,
        dismiss: () => onDismissMessage?.(message.id),
      })),
    ].slice(-MAX_VISIBLE),
  );
  let pausedKeys = $state<ReadonlySet<string>>(new Set());
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  $effect(() => {
    const active = new Map<string, Toast>();
    for (const toast of visible) {
      if (!pausedKeys.has(toast.key)) active.set(toast.key, toast);
    }
    for (const [key, timer] of timers) {
      if (!active.has(key)) {
        clearTimeout(timer);
        timers.delete(key);
      }
    }
    for (const [key, toast] of active) {
      if (timers.has(key)) continue;
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          toast.dismiss();
        }, toast.durationMs),
      );
    }
  });

  $effect(() => {
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  });

  function pause(key: string): void {
    if (pausedKeys.has(key)) return;
    pausedKeys = new Set(pausedKeys).add(key);
  }

  function resume(key: string): void {
    if (!pausedKeys.has(key)) return;
    const next = new Set(pausedKeys);
    next.delete(key);
    pausedKeys = next;
  }

  function handleFocusOut(event: FocusEvent, key: string): void {
    const toast = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && toast.contains(event.relatedTarget)) {
      return;
    }
    resume(key);
  }

  function handleAction(toast: Toast): void {
    toast.dismiss();
    toast.action?.run();
  }

  function handleOpen(toast: Toast): void {
    if (toast.conflict !== null) onOpen?.(toast.conflict.path);
    toast.dismiss();
  }
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each visible as toast (toast.key)}
    <div
      class="toast"
      role="group"
      data-tone={toast.tone}
      aria-label={toneLabel(toast.tone)}
      onmouseenter={() => pause(toast.key)}
      onmouseleave={() => resume(toast.key)}
      onfocusin={() => pause(toast.key)}
      onfocusout={(event) => handleFocusOut(event, toast.key)}
    >
      <p class="text">{toast.text}</p>
      <div class="actions">
        {#if toast.action}
          <button
            type="button"
            class="button"
            data-testid="toast-action"
            onclick={() => handleAction(toast)}
          >
            {toast.action.label}
          </button>
        {/if}
        {#if toast.conflict !== null && onOpen}
          <button type="button" class="button" onclick={() => handleOpen(toast)}>
            Open note
          </button>
        {/if}
        <button
          type="button"
          class="button button-ghost"
          aria-label="Dismiss notice"
          onclick={toast.dismiss}
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
    left: 50%;
    transform: translateX(-50%);
    box-sizing: border-box;
    width: min(var(--toast-width), 100%);
    bottom: calc(
      var(--touch-target) + var(--space-2) * 2 + var(--hairline) +
        env(safe-area-inset-bottom, 0px)
    );
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface-raised);
    border: var(--hairline) solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-2);
    transition:
      opacity var(--motion-duration) var(--motion-easing),
      transform var(--motion-duration) var(--motion-easing);
  }

  @starting-style {
    .toast {
      opacity: 0;
      transform: translateY(var(--space-2));
    }
  }

  .text {
    margin: 0;
    font-size: var(--font-size-sm);
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .actions .button {
    min-height: 0;
    min-width: 0;
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
  }

  .actions .button:hover {
    background: color-mix(
      in srgb,
      var(--color-text) 14%,
      var(--color-surface-raised)
    );
  }

  @media (min-width: 768px) {
    .toasts {
      bottom: 0;
      padding-bottom: var(--space-3);
    }
  }
</style>
