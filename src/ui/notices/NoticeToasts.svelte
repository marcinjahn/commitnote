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
  import { toastOut, toastReflow } from "./toast-motion";
  import { dismissIcon, toneIcons } from "./tone-icons";

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
    if (pausedKeys.has(key) || !visible.some((toast) => toast.key === key)) return;
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
      out:toastOut
      animate:toastReflow
      onmouseenter={() => pause(toast.key)}
      onmouseleave={() => resume(toast.key)}
      onfocusin={() => pause(toast.key)}
      onfocusout={(event) => handleFocusOut(event, toast.key)}
    >
      <svg
        class="icon tone-icon"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        {#each toneIcons[toast.tone] as d (d)}<path {d} />{/each}
      </svg>
      <div class="body">
        <p class="text">{toast.text}</p>
        {#if toast.action || (toast.conflict !== null && onOpen)}
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
          </div>
        {/if}
      </div>
      <button
        type="button"
        class="button button-ghost dismiss"
        aria-label="Dismiss notice"
        onclick={toast.dismiss}
      >
        <svg
          class="icon"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          {#each dismissIcon as d (d)}<path {d} />{/each}
        </svg>
      </button>
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
    --toast-tone: var(--color-text-muted);
    pointer-events: auto;
    display: grid;
    grid-template-columns: auto 1fr auto;
    column-gap: var(--space-2);
    align-items: start;
    font-size: var(--font-size-sm);
    line-height: var(--line-height);
    padding: var(--space-3);
    padding-left: calc(var(--space-3) + 2px);
    background: var(--color-surface-raised);
    border: var(--hairline) solid var(--color-border);
    border-radius: var(--radius);
    box-shadow:
      inset 2px 0 0 var(--toast-tone),
      var(--shadow-1);
    transition:
      opacity var(--motion-duration) var(--motion-easing),
      transform var(--motion-duration) var(--motion-easing);
  }

  .toast:global([inert]) {
    transition: none;
  }

  @starting-style {
    .toast {
      opacity: 0;
      transform: translateY(var(--space-2));
    }
  }

  .toast[data-tone="success"] {
    --toast-tone: var(--color-tone-success);
  }

  .toast[data-tone="info"] {
    --toast-tone: var(--color-tone-info);
  }

  .toast[data-tone="warning"] {
    --toast-tone: var(--color-tone-warning);
    background: color-mix(in srgb, var(--toast-tone) 5%, var(--color-surface-raised));
  }

  .toast[data-tone="error"] {
    --toast-tone: var(--color-tone-error);
    background: color-mix(in srgb, var(--toast-tone) 5%, var(--color-surface-raised));
  }

  .tone-icon {
    color: var(--toast-tone);
    margin-block: calc((1lh - var(--icon-size)) / 2);
  }

  .toast[data-tone="info"] .tone-icon {
    color: var(--color-text-muted);
  }

  .body {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    column-gap: var(--space-3);
    row-gap: calc(var(--space-2) + var(--space-1) + var(--hairline));
    min-width: 0;
  }

  .text {
    flex: 1 1 auto;
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text);
    overflow-wrap: anywhere;
  }

  .dismiss {
    --toast-dismiss-size: 32px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--toast-dismiss-size);
    height: var(--toast-dismiss-size);
    min-width: 0;
    min-height: 0;
    padding: 0;
    margin-block: calc((1lh - var(--toast-dismiss-size)) / 2);
    margin-inline-end: calc(var(--space-2) * -1);
    color: var(--color-text-muted);
  }

  @media (pointer: coarse) {
    .dismiss {
      --toast-dismiss-size: var(--touch-target);
    }
  }

  .dismiss:hover {
    color: var(--color-text);
    background: color-mix(
      in srgb,
      var(--color-text) 14%,
      var(--color-surface-raised)
    );
  }

  .dismiss .icon {
    width: 12px;
    height: 12px;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }

  .actions .button {
    min-height: 0;
    min-width: 0;
    padding: var(--space-1) var(--space-3);
    margin-block: calc((var(--space-1) + var(--hairline)) * -1);
    font-size: var(--font-size-sm);
    line-height: var(--line-height);
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
