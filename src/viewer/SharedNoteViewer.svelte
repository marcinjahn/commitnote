<script lang="ts">
  import { onMount, tick } from "svelte";
  import MarkdownEditor from "../ui/editor/MarkdownEditor.svelte";
  import Wordmark from "../ui/wordmark/Wordmark.svelte";
  import { livePreview } from "../editor/live-preview";
  import { linkOpen } from "../editor/link-open";
  import { describeShareDate } from "../ui/share/share-messages";
  import type { ViewerController, ViewerState } from "./viewer-state";
  import {
    describeViewerError,
    FOOTER_TEXT,
    LOADING_TEXT,
    PASSWORD_HEADING,
    UNLOCK_LABEL,
    UNLOCKING_LABEL,
    VIEWER_TITLE,
    WRONG_PASSWORD_TEXT,
  } from "./viewer-messages";

  interface Props {
    controller: ViewerController;
    testModeBanner: string | null;
  }

  const { controller, testModeBanner }: Props = $props();

  let view = $state<ViewerState>({ kind: "loading" });
  let password = $state("");
  let copyResult = $state<"copied" | "failed" | null>(null);
  let passwordInput = $state<HTMLInputElement>();

  const editorExtensions = [livePreview(), linkOpen()];

  onMount(() => {
    document.title = VIEWER_TITLE;
    const unsubscribe = controller.subscribe((next) => {
      view = next;
    });
    void controller.start();
    return unsubscribe;
  });

  let lastWrong = false;
  $effect(() => {
    const wrong =
      view.kind === "password" && view.wrongPassword && !view.busy;
    if (wrong && !lastWrong) {
      void tick().then(() => {
        passwordInput?.focus();
        passwordInput?.select();
      });
    }
    lastWrong = wrong;
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    void controller.unlock(password);
  }

  async function copy(markdown: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(markdown);
      copyResult = "copied";
    } catch {
      copyResult = "failed";
    }
  }
</script>

{#if testModeBanner !== null}
  <p class="notice test-mode-banner" role="note">{testModeBanner}</p>
{/if}

<div class="viewer">
  <header class="top-bar">
    <Wordmark />
  </header>

  <main class="column">
    {#if view.kind === "loading"}
      <h1 class="visually-hidden">Shared note</h1>
      <p class="muted" role="status">{LOADING_TEXT}</p>
    {:else if view.kind === "password"}
      <h1>{PASSWORD_HEADING}</h1>
      <form class="password-form" onsubmit={submit}>
        <div class="field">
          <label for="share-password">Password</label>
          <input
            id="share-password"
            type="password"
            autocomplete="off"
            bind:this={passwordInput}
            bind:value={password}
            aria-invalid={view.wrongPassword ? "true" : undefined}
            aria-describedby={view.wrongPassword ? "share-password-error" : undefined}
          />
          {#if view.wrongPassword}
            <p id="share-password-error" class="error-text">{WRONG_PASSWORD_TEXT}</p>
          {/if}
        </div>
        <button class="button button-primary" type="submit" disabled={view.busy}>
          {view.busy ? UNLOCKING_LABEL : UNLOCK_LABEL}
        </button>
      </form>
    {:else if view.kind === "note"}
      {@const note = view.note}
      <div class="note-head">
        <div class="note-title">
          <h1>{note.name}</h1>
          <p class="muted">{describeShareDate(note)}</p>
        </div>
        <button class="button" type="button" onclick={() => copy(note.markdown)}>
          Copy text
        </button>
      </div>
      <p class="muted copy-status" role="status">
        {#if copyResult === "copied"}
          Text copied
        {:else if copyResult === "failed"}
          Couldn't copy. Select the text and copy it.
        {/if}
      </p>
      <MarkdownEditor
        text={note.markdown}
        readOnly={true}
        onChange={() => {}}
        extensions={editorExtensions}
        ariaLabel="Shared note"
        noteFont="inter"
      />
    {:else}
      <h1 class="visually-hidden">Shared note</h1>
      <div class="error-block" role="alert">
        <p>{describeViewerError(view.error, view.provider)}</p>
        {#if view.retryable}
          <button class="button" type="button" onclick={() => controller.retry()}>
            Try again
          </button>
        {/if}
      </div>
    {/if}
  </main>

  {#if view.kind === "note"}
    <footer class="footer">{FOOTER_TEXT}</footer>
  {/if}
</div>

<style>
  .test-mode-banner {
    margin: 0;
    text-align: center;
    font-size: var(--font-size-xs);
    letter-spacing: 0.02em;
    padding: var(--space-1) var(--space-3);
  }

  .viewer {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .top-bar {
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--hairline) solid var(--color-border);
  }

  .column {
    width: 100%;
    max-width: var(--content-max-width);
    margin: 0 auto;
    padding: var(--space-5) var(--space-4);
    box-sizing: border-box;
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  h1 {
    margin: 0;
    font-size: var(--font-size-xl);
    letter-spacing: var(--letter-spacing-tighter);
    overflow-wrap: anywhere;
  }

  .muted {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .password-form {
    display: grid;
    gap: var(--space-3);
    max-width: 360px;
  }

  .error-text {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .field input[aria-invalid="true"] {
    border-color: var(--color-danger);
  }

  .note-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .note-title {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  .copy-status {
    min-height: 1.2em;
  }

  .error-block {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
    padding: var(--space-3);
    background: var(--color-danger-surface);
    border: var(--hairline) solid var(--color-danger);
  }

  .error-block p {
    margin: 0;
  }

  .footer {
    padding: var(--space-3) var(--space-4);
    text-align: center;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    border-top: var(--hairline) solid var(--color-border);
  }
</style>
