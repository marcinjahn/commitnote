<script lang="ts">
  import type { NotePath } from "../../changes/change";
  import type { ForgeId } from "../../forge/repo-coordinates";
  import { sharesOfNote, type ShareEntry, type ShareIndex } from "../../share/share-index";
  import type { ShareError, ShareService } from "../../share/share-service";
  import type { WorkingTree } from "../../sync/working-tree";
  import { MAX_SHARE_LABEL_LENGTH } from "../../share/share-label";
  import Dialog from "../dialogs/Dialog.svelte";
  import {
    COPY_LINK_LABEL,
    COPY_PASSWORD_LABEL,
    CREATE_ANOTHER_LINK_LABEL,
    CREATE_LINK_LABEL,
    CREATING_LINK_LABEL,
    describeShareError,
    LINK_COPIED_TEXT,
    messageText,
    PASSWORD_COPIED_TEXT,
    SHARE_LABEL_FIELD,
    SHARE_LINK_LABEL,
    SHARE_PASSWORD_FIELD,
    SHARE_PASSWORD_HINT,
    SHARE_PASSWORD_LABEL,
    shareDialogTitle,
    shareExplanation,
    SHARED_LINKS_TITLE,
    type MessagePart,
  } from "./share-messages";
  import ShareList from "./ShareList.svelte";

  interface Props {
    open: boolean;
    noteName: string;
    path: NotePath;
    shares: ShareIndex | null;
    tree: WorkingTree | null;
    linkBase: string;
    forgeId: ForgeId;
    shareService: ShareService;
    onCopyLink: (entry: ShareEntry) => void;
    onCopyPassword: (entry: ShareEntry) => void;
    onViewVersion: (entry: ShareEntry) => void;
    updatingId: string | null;
    onUpdate: (entry: ShareEntry) => void;
    onRename: (entry: ShareEntry) => void;
    onRevoke: (entry: ShareEntry) => void;
    onCopyText: (text: string, copied: string) => Promise<boolean>;
    onClose: () => void;
  }

  const {
    open,
    noteName,
    path,
    shares,
    tree,
    linkBase,
    forgeId,
    shareService,
    onCopyLink,
    onCopyPassword,
    onViewVersion,
    updatingId,
    onUpdate,
    onRename,
    onRevoke,
    onCopyText,
    onClose,
  }: Props = $props();

  const uid = $props.id();
  const labelId = `share-label-${uid}`;
  const passwordId = `share-password-${uid}`;
  const hintId = `share-password-hint-${uid}`;
  const linkFieldId = `share-link-${uid}`;
  const passwordFieldId = `share-password-result-${uid}`;

  let label = $state("");
  let password = $state("");
  let running = $state(false);
  let error = $state<readonly MessagePart[] | null>(null);
  let created = $state<{ link: string; password: string | null } | null>(null);
  let linkField: HTMLInputElement | undefined = $state();
  let passwordField: HTMLInputElement | undefined = $state();

  const existing = $derived(shares === null ? [] : sharesOfNote(shares, path));
  const unreadable = $derived(shares !== null && !shares.writable);
  const explanation = $derived(shareExplanation(forgeId));

  function fail(shareError: ShareError): void {
    error = describeShareError(shareError, forgeId);
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (running || unreadable) return;
    running = true;
    error = null;
    try {
      const result = await shareService.createShare({ path, password, label });
      if (result.ok) {
        created = { link: result.link, password: result.password };
      } else {
        fail(result.error);
      }
    } finally {
      running = false;
    }
  }

  async function copyField(
    value: string,
    field: HTMLInputElement | undefined,
    copied: string,
  ): Promise<void> {
    if (await onCopyText(value, copied)) return;
    field?.focus();
    field?.select();
  }

  function createAnother(): void {
    created = null;
    label = "";
    password = "";
    error = null;
  }
</script>

<Dialog {open} title={shareDialogTitle(noteName)} closeButton {onClose}>
  {#snippet children()}
    <div class="share-dialog">
      {#if existing.length > 0}
        <section class="existing">
          <h3 class="existing-heading">{SHARED_LINKS_TITLE}</h3>
          <ShareList
            entries={existing}
            {linkBase}
            {tree}
            writable={shares?.writable ?? false}
            {onCopyLink}
            {onCopyPassword}
            {onViewVersion}
            {updatingId}
            {onUpdate}
            onOpenNote={undefined}
            {onRename}
            {onRevoke}
          />
        </section>
      {/if}

      {#if unreadable}
        <p class="alert-error" role="alert">
          {messageText(describeShareError({ kind: "sharesUnavailable" }, forgeId))}
        </p>
      {:else}
        <p class="explanation">{explanation}</p>
      {/if}

      {#if created === null}
        <form class="share-form" onsubmit={handleSubmit}>
          <div class="field">
            <label for={labelId}>{SHARE_LABEL_FIELD}</label>
            <input
              id={labelId}
              type="text"
              autocomplete="off"
              maxlength={MAX_SHARE_LABEL_LENGTH}
              placeholder={noteName}
              bind:value={label}
              disabled={unreadable || running}
            />
          </div>
          <div class="field">
            <label for={passwordId}>{SHARE_PASSWORD_FIELD}</label>
            <input
              id={passwordId}
              type="text"
              autocomplete="off"
              spellcheck="false"
              aria-describedby={hintId}
              bind:value={password}
              disabled={unreadable || running}
            />
            <span id={hintId} class="field-hint"
              >{SHARE_PASSWORD_HINT}</span>
          </div>
          {#if error !== null}
            <p class="alert-error" role="alert">
              {#each error as part, index (index)}
                {#if part.kind === "link"}
                  <a href={part.href} target="_blank" rel="noopener noreferrer"
                    >{part.text}</a
                  >
                {:else}
                  {part.text}
                {/if}
              {/each}
            </p>
          {/if}
          <div>
            <button
              type="submit"
              class="button button-primary"
              disabled={unreadable || running}
            >
              {running ? CREATING_LINK_LABEL : CREATE_LINK_LABEL}
            </button>
          </div>
        </form>
      {:else}
        <div class="share-form">
          <div class="field">
            <label for={linkFieldId}>{SHARE_LINK_LABEL}</label>
            <div class="copy-row">
              <input
                id={linkFieldId}
                type="text"
                readonly
                value={created.link}
                bind:this={linkField}
              />
              <button
                type="button"
                class="button"
                onclick={() =>
                  void copyField(created?.link ?? "", linkField, LINK_COPIED_TEXT)}
                >{COPY_LINK_LABEL}</button
              >
            </div>
          </div>
          {#if created.password !== null}
            <div class="field">
              <label for={passwordFieldId}>{SHARE_PASSWORD_LABEL}</label>
              <div class="copy-row">
                <input
                  id={passwordFieldId}
                  type="text"
                  readonly
                  value={created.password}
                  bind:this={passwordField}
                />
                <button
                  type="button"
                  class="button"
                  onclick={() =>
                    void copyField(
                      created?.password ?? "",
                      passwordField,
                      PASSWORD_COPIED_TEXT,
                    )}>{COPY_PASSWORD_LABEL}</button
                >
              </div>
            </div>
          {/if}
          <div>
            <button type="button" class="button button-ghost" onclick={createAnother}
              >{CREATE_ANOTHER_LINK_LABEL}</button
            >
          </div>
        </div>
      {/if}
    </div>
  {/snippet}
</Dialog>

<style>
  .share-dialog {
    display: grid;
    gap: var(--space-4);
  }

  .existing-heading {
    margin: 0 0 var(--space-1);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    color: var(--color-text-muted);
  }

  .explanation {
    margin: 0;
  }

  .share-form {
    display: grid;
    gap: var(--space-3);
  }

  .copy-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .copy-row input {
    flex: 1 1 12rem;
    min-width: 0;
  }
</style>
