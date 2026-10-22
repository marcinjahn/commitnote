import { isPersistentToast } from "../ui/notices/notice-messages";
import type { AppSession, NativeRunningApp } from "./app-session";
import type { EmitCoreEvent } from "./commands/command-context";

export type ActionNoticeChannel = "trash" | "place" | "tag";

export type NoticeUndo = () => Promise<
  { readonly kind: "ok" } | { readonly kind: "error"; readonly message: string }
>;

export interface ActionNotices {
  showUndo(
    owner: NativeRunningApp,
    channel: ActionNoticeChannel,
    message: string,
    undo: NoticeUndo,
  ): void;
  clear(channel: ActionNoticeChannel): void;
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

  function clear(channel: ActionNoticeChannel): void {
    const notice = held.get(channel);
    if (notice === undefined) return;
    held.delete(channel);
    emit("noticeCleared", { id: notice.id });
  }

  function show(
    owner: NativeRunningApp,
    channel: ActionNoticeChannel,
    tone: "success" | "error",
    message: string,
    undo: NoticeUndo | null,
  ): void {
    clear(channel);
    const id = `${ID_PREFIX}${nextId++}`;
    held.set(channel, { id, owner, undo });
    emit("notice", {
      id,
      tone,
      message,
      persistent: isPersistentToast(tone, undo !== null),
      action: undo === null ? null : { kind: "undo", label: "Undo" },
    });
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
      show(owner, channel, "success", message, undo);
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
        show(notice.owner, channel, "error", outcome.message, null);
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
