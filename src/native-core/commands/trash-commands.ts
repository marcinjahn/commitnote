import {
  deleteFromTrash,
  emptyTrash,
  restoreFromTrash,
} from "../../app/structure-actions";
import {
  findTrashItem,
  type ReadableWorkingTrashEntry,
} from "../../sync/working-trash";
import { listMoveTargets } from "../../ui/dialogs/folder-options";
import type { CoreCommands } from "../api";
import type { AppSession, NativeRunningApp } from "../app-session";
import type { EngineEvents } from "../engine-events";
import {
  invalidParams,
  notReady,
  pathParam,
  stringParam,
  type CommandHandler,
} from "./command-context";
import { toOutcome } from "./structure-commands";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

export function createTrashCommands(context: {
  readonly app: AppSession;
  readonly events: EngineEvents;
}): Record<string, CommandHandler> {
  const { app, events } = context;

  function running(): NativeRunningApp {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  function entryOf(
    current: NativeRunningApp,
    entryId: string,
  ): ReadableWorkingTrashEntry {
    const entry = current.engine
      .getState()
      .visibleTrash?.find((candidate) => candidate.id === entryId);
    if (entry === undefined) throw invalidParams();
    return entry;
  }

  return {
    async "trash.restoreTargets"(params): Promise<Result<"trash.restoreTargets">> {
      const entryId = stringParam(params, "entryId");
      const subPath = pathParam(params, "subPath");
      const current = running();
      const item = findTrashItem(entryOf(current, entryId), subPath);
      const tree = current.engine.getState().workingTree;
      if (item === undefined || tree === null) throw invalidParams();
      return {
        targets: listMoveTargets(tree, null, item.kind).map((target) => ({
          path: [...target.path],
          label: target.label,
          depth: target.depth,
          disabled: target.disabled,
        })),
      };
    },

    async "trash.restore"(params): Promise<Result<"trash.restore">> {
      const entryId = stringParam(params, "entryId");
      const subPath = pathParam(params, "subPath");
      const parent = pathParam(params, "parent");
      return {
        outcome: toOutcome(
          restoreFromTrash(running().engine, entryId, subPath, parent),
        ),
      };
    },

    async "trash.delete"(params): Promise<Result<"trash.delete">> {
      deleteFromTrash(running().engine, stringParam(params, "entryId"));
      return {};
    },

    async "trash.empty"(): Promise<Result<"trash.empty">> {
      emptyTrash(running().engine);
      return {};
    },
  };
}
