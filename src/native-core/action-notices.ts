import { isPersistentToast } from "../ui/notices/notice-messages";
import type { AppSession, NativeRunningApp } from "./app-session";
import type { EmitCoreEvent } from "./commands/command-context";

export type ActionNoticeChannel =
  "trash" | "place" | "tag" | "image" | "history" | "share";

export type ActionNoticeTone = "info" | "success" | "error";

export type NoticeUndo = () => Promise<
  { readonly kind: "ok" } | { readonly kind: "error"; readonly message: string }
>;

export interface ActionNotices {
  showUndo(
    owner: NativeRunningApp,
    channel: ActionNoticeChannel,
    message: string,
    undo: NoticeUndo,
  ): string;
  show(
    owner: NativeRunningApp,
    channel: ActionNoticeChannel,
    tone: ActionNoticeTone,
    message: string,
    options?: { readonly persistent?: boolean },
  ): string;
  /** With `id`, clears the channel only while that notice is still the one shown on it. */
  clear(channel: ActionNoticeChannel, id?: string): void;
  perform(id: string): Promise<void>;
  /** False when `id` is not an action notice id at all. */
  dismiss(id: string): boolean;
  dispose(): void;
}

const ID_PREFIX = "action-";

interface HeldNotice {
  readonly id: string;
  readonly owner: NativeRunningApp;
  readonly undo: NoticeUndo | null;
}

export function createActionNotices(options: {
  readonly app: AppSession;
  readonly emit: EmitCoreEvent;
}): ActionNotices {
  const { app, emit } = options;
  const held = new Map<ActionNoticeChannel, HeldNotice>();
  let nextId = 1;

  function clear(channel: ActionNoticeChannel, id?: string): void {
    const notice = held.get(channel);
    if (notice === undefined) return;
    if (id !== undefined && notice.id !== id) return;
    held.delete(channel);
    emit("noticeCleared", { id: notice.id });
  }

  function post(
    owner: NativeRunningApp,
    channel: ActionNoticeChannel,
    tone: ActionNoticeTone,
    message: string,
    undo: NoticeUndo | null,
    persistent: boolean,
  ): string {
    clear(channel);
    const id = `${ID_PREFIX}${nextId++}`;
    held.set(channel, { id, owner, undo });
    emit("notice", {
      id,
      tone,
      message,
      persistent,
      action: undo === null ? null : { kind: "undo", label: "Undo" },
    });
    return id;
  }

  function channelOf(id: string): ActionNoticeChannel | null {
    for (const [channel, notice] of held) {
      if (notice.id === id) return channel;
    }
    return null;
  }

  const stopListening = app.onEngineState((engine) => {
    if (engine === null) held.clear();
  });

  return {
    showUndo(owner, channel, message, undo) {
      return post(
        owner,
        channel,
        "success",
        message,
        undo,
        isPersistentToast("success", true),
      );
    },
    show(owner, channel, tone, message, options) {
      return post(
        owner,
        channel,
        tone,
        message,
        null,
        options?.persistent ?? isPersistentToast(tone, false),
      );
    },
    clear,
    async perform(id) {
      const channel = channelOf(id);
      if (channel === null) return;
      const notice = held.get(channel)!;
      if (notice.undo === null) return;
      clear(channel);
      if (app.current() !== notice.owner) return;
      const outcome = await notice.undo();
      if (outcome.kind === "error" && app.current() === notice.owner) {
        post(
          notice.owner,
          channel,
          "error",
          outcome.message,
          null,
          isPersistentToast("error", false),
        );
      }
    },
    dismiss(id) {
      if (!id.startsWith(ID_PREFIX)) return false;
      const channel = channelOf(id);
      if (channel !== null) clear(channel);
      return true;
    },
    dispose() {
      stopListening();
      held.clear();
    },
  };
}
