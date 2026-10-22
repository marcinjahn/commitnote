import type { ActionNotices } from "../action-notices";
import type { CoreCommands } from "../api";
import type { AppSession } from "../app-session";
import { coreLevelError, toCoreError } from "../core-errors";
import {
  REFRESH_NOTICE_ID,
  REFRESH_REJECTED_MESSAGE,
  type EngineEvents,
} from "../engine-events";
import type { DraftCommands } from "./draft-commands";
import { toOpenNote } from "../open-note-view";
import { toTreeNodes } from "../tree-view";
import {
  CoreCommandError,
  invalidParams,
  notReady,
  stringParam,
  type CommandHandler,
  type CommandParams,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

const ENGINE_NOTICE_PREFIX = "engine-";

function pathParam(params: CommandParams): string[] | null {
  const value = params.path;
  if (value === null) return null;
  if (!Array.isArray(value) || !value.every((s) => typeof s === "string")) {
    throw invalidParams();
  }
  return value as string[];
}

export function createNotesCommands(context: {
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly drafts: Pick<DraftCommands, "discard">;
  readonly notices: Pick<ActionNotices, "dismiss">;
}): Record<string, CommandHandler> {
  const { app, events, drafts, notices } = context;

  function running() {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  return {
    async "tree.get"(): Promise<Result<"tree.get">> {
      return { tree: toTreeNodes(running().engine.getState().workingTree) };
    },

    async "note.open"(params): Promise<Result<"note.open">> {
      const path = pathParam(params);
      const { engine } = running();
      drafts.discard();
      events.noteSwitched();
      await engine.openNote(path);
      return {
        note: toOpenNote(engine.getState(), {
          forgeName: app.activeForgeName(),
          deviceName: app.deviceName,
        }),
      };
    },

    async "sync.refresh"(): Promise<Result<"sync.refresh">> {
      const { engine, autoRefresh } = running();
      try {
        await engine.refresh();
      } catch {
        events.refreshFailed(null);
        throw new CoreCommandError({
          ...coreLevelError("internal"),
          message: REFRESH_REJECTED_MESSAGE,
        });
      }
      const error = engine.getState().refresh.lastError;
      if (error === null) {
        autoRefresh.manualRefreshed();
        events.refreshSucceeded();
        return {};
      }
      events.refreshFailed(error);
      throw new CoreCommandError(
        toCoreError(error, { source: "sync", forgeName: app.activeForgeName() }),
      );
    },

    async "device.name"(): Promise<Result<"device.name">> {
      return { name: app.deviceName() };
    },

    async "notices.dismiss"(params): Promise<Result<"notices.dismiss">> {
      const id = stringParam(params, "id");
      if (id === REFRESH_NOTICE_ID) {
        events.clearRefreshNotice();
        return {};
      }
      if (notices.dismiss(id)) return {};
      if (!id.startsWith(ENGINE_NOTICE_PREFIX)) throw invalidParams();
      const noticeId = Number(id.slice(ENGINE_NOTICE_PREFIX.length));
      if (!Number.isSafeInteger(noticeId)) throw invalidParams();
      app.current()?.engine.dismissNotice(noticeId);
      return {};
    },
  };
}
