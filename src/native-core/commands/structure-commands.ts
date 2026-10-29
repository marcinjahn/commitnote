import { isAtOrWithin, type NotePath } from "../../changes/change";
import {
  moveAmongSiblings,
  moveNode,
  placeNode,
  renameNode,
  setNodeColorTag,
  trashNode,
  trashPreview,
  undoPlace,
  undoTrash,
  type PlaceOutcome,
  type StructureActionOutcome,
} from "../../app/structure-actions";
import type { SyncEngineState } from "../../sync/sync-engine";
import { findWorkingNode } from "../../sync/working-tree";
import { parseColorTag, type ColorTag } from "../../tags/color-tag";
import { listMoveTargets } from "../../ui/dialogs/folder-options";
import { describeTrashConfirmation } from "../../ui/trash/trash-messages";
import type { ActionNotices } from "../action-notices";
import type { CoreCommands, StructureOutcome, TrashPreview } from "../api";
import type { AppSession, NativeRunningApp } from "../app-session";
import type { EngineEvents } from "../engine-events";
import {
  invalidParams,
  notReady,
  stringParam,
  type CommandHandler,
  type CommandParams,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

function pathParam(params: CommandParams, name: string): string[] {
  const value = params[name];
  if (!Array.isArray(value) || !value.every((s) => typeof s === "string")) {
    throw invalidParams();
  }
  return value as string[];
}

function nodePathParam(params: CommandParams): string[] {
  const path = pathParam(params, "path");
  if (path.length === 0) throw invalidParams();
  return path;
}

function nullableStringParam(
  params: CommandParams,
  name: string,
): string | null {
  const value = params[name];
  if (value === null) return null;
  if (typeof value !== "string") throw invalidParams();
  return value;
}

function directionParam(params: CommandParams): "up" | "down" {
  const value = params.direction;
  if (value !== "up" && value !== "down") throw invalidParams();
  return value;
}

function tagParam(params: CommandParams): ColorTag | null {
  const value = params.tag;
  if (value === null) return null;
  const tag = parseColorTag(value);
  if (tag === null) throw invalidParams();
  return tag;
}

function shareCountParam(params: CommandParams): number {
  const value = params.shareCount;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidParams();
  }
  return value;
}

export function toOutcome(outcome: StructureActionOutcome): StructureOutcome {
  return outcome.kind === "ok"
    ? { kind: "ok", path: [...outcome.path] }
    : outcome;
}

function previewOf(
  state: SyncEngineState,
  path: NotePath,
): TrashPreview | null {
  const node =
    state.workingTree === null
      ? undefined
      : findWorkingNode(state.workingTree, path);
  if (node === undefined) return null;
  const { itemCount, shareCount } = trashPreview(state, path);
  const confirmation = describeTrashConfirmation({
    name: node.name,
    kind: node.kind,
    itemCount,
    shareCount,
    revoking: false,
  });
  return {
    title: confirmation.title,
    message: [
      confirmation.body,
      confirmation.shareWarning,
      confirmation.retentionNote,
    ]
      .filter((part): part is string => part !== null)
      .join("\n\n"),
    confirmLabel: confirmation.confirmLabel,
    itemCount,
    shareCount,
  };
}

export function createStructureCommands(context: {
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly notices: ActionNotices;
}): Record<string, CommandHandler> {
  const { app, events, notices } = context;

  function running(): NativeRunningApp {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  function placed(
    current: NativeRunningApp,
    outcome: PlaceOutcome,
  ): StructureOutcome {
    if (outcome.kind === "error") return outcome;
    if (outcome.notice === null) {
      notices.clear("place");
    } else {
      const { undo } = outcome;
      notices.showUndo(current, "place", outcome.notice, async () =>
        undoPlace(current.engine, undo),
      );
    }
    return { kind: "ok", path: [...outcome.path] };
  }

  return {
    async "node.rename"(params): Promise<Result<"node.rename">> {
      const path = nodePathParam(params);
      const name = stringParam(params, "name");
      return { outcome: toOutcome(renameNode(running().engine, path, name)) };
    },

    async "node.move"(params): Promise<Result<"node.move">> {
      const path = nodePathParam(params);
      const parent = pathParam(params, "parent");
      return { outcome: toOutcome(moveNode(running().engine, path, parent)) };
    },

    async "node.place"(params): Promise<Result<"node.place">> {
      const path = nodePathParam(params);
      const parent = pathParam(params, "parent");
      const before = nullableStringParam(params, "before");
      const current = running();
      return {
        outcome: placed(
          current,
          placeNode(current.engine, path, { parent, before }),
        ),
      };
    },

    async "node.moveSibling"(params): Promise<Result<"node.moveSibling">> {
      const path = nodePathParam(params);
      const direction = directionParam(params);
      const current = running();
      const outcome = moveAmongSiblings(current.engine, path, direction);
      if (outcome.kind === "none") return { outcome };
      return { outcome: placed(current, outcome) };
    },

    async "node.moveTargets"(params): Promise<Result<"node.moveTargets">> {
      const path = nodePathParam(params);
      const tree = running().engine.getState().workingTree;
      if (tree === null) throw notReady();
      const node = findWorkingNode(tree, path);
      if (node === undefined) throw invalidParams();
      return {
        targets: listMoveTargets(tree, path, node.kind).map((target) => ({
          path: [...target.path],
          label: target.label,
          depth: target.depth,
          disabled: target.disabled,
        })),
      };
    },

    async "node.trashPreview"(params): Promise<Result<"node.trashPreview">> {
      const path = nodePathParam(params);
      const preview = previewOf(running().engine.getState(), path);
      if (preview === null) throw invalidParams();
      return { preview };
    },

    async "node.trash"(params): Promise<Result<"node.trash">> {
      const path = nodePathParam(params);
      const confirmedShareCount = shareCountParam(params);
      const current = running();
      const { engine } = current;
      const open = engine.getState().openNote;
      const reopen =
        open !== null && isAtOrWithin(open.path, path) ? [...open.path] : null;
      const outcome = await trashNode(
        {
          engine,
          revokeShares: (target) =>
            current.services.shareService.revokeShares(target),
          forgeId: current.session.coordinates.forge,
          proceed: () => app.current() === current,
        },
        path,
        confirmedShareCount,
      );
      switch (outcome.kind) {
        case "abandoned":
          throw notReady();
        case "error":
          return { outcome: { kind: "error", message: outcome.message } };
        case "sharesChanged": {
          const preview = previewOf(engine.getState(), path);
          if (preview === null) throw invalidParams();
          return { outcome: { kind: "confirm", preview } };
        }
        case "deleted":
          notices.clear("trash");
          return { outcome: { kind: "deleted" } };
        case "trashed": {
          const { entryId } = outcome;
          notices.showUndo(current, "trash", outcome.notice, async () => {
            const undone = undoTrash(engine, entryId, reopen);
            if (undone.kind === "error") return undone;
            if (undone.reopen !== null) {
              events.noteSwitched();
              await engine.openNote(undone.reopen);
            }
            return { kind: "ok" };
          });
          return { outcome: { kind: "trashed", entryId } };
        }
      }
    },

    async "node.setColorTag"(params): Promise<Result<"node.setColorTag">> {
      const path = nodePathParam(params);
      const tag = tagParam(params);
      return {
        outcome: toOutcome(setNodeColorTag(running().engine, path, tag)),
      };
    },

    async "notices.perform"(params): Promise<Result<"notices.perform">> {
      const id = stringParam(params, "id");
      await notices.perform(id);
      return {};
    },
  };
}
