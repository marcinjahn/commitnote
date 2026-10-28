import {
  commitNoteDraftContent,
  commitNoteDraftName,
  draftSiblingNames,
} from "../../app/note-draft-actions";
import type { NoteDraftOutcome as DraftOutcome } from "../../app/note-draft-actions";
import type { RunningApp } from "../../app/start-app";
import { findWorkingFolder } from "../../sync/working-tree";
import { describeStructureError } from "../../ui/browse/structure-messages";
import type { CoreCommands, NoteDraft } from "../api";
import type { AppSession } from "../app-session";
import type { EngineEvents } from "../engine-events";
import type { HostServices } from "../host-services";
import {
  invalidParams,
  notReady,
  stringParam,
  type CommandHandler,
  type CommandParams,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

export interface DraftCommands {
  readonly handlers: Record<string, CommandHandler>;
  discard(): void;
}

function pathParam(params: CommandParams, name: string): string[] {
  const value = params[name];
  if (!Array.isArray(value) || !value.every((s) => typeof s === "string")) {
    throw invalidParams();
  }
  return value as string[];
}

export function createDraftCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
}): DraftCommands {
  const { host, app, events } = context;
  let active: { readonly owner: RunningApp; draft: NoteDraft } | null = null;

  function running(): RunningApp {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  function activeDraft(current: RunningApp): NoteDraft | null {
    if (active === null) return null;
    if (active.owner !== current) {
      active = null;
      return null;
    }
    return active.draft;
  }

  async function settle(
    current: RunningApp,
    draft: NoteDraft,
    outcome: DraftOutcome,
  ): Promise<Result<"draft.commitName">> {
    switch (outcome.kind) {
      case "created":
        active = null;
        await current.engine.openNote(outcome.path);
        return {
          outcome: {
            kind: "created",
            path: [...outcome.path],
            fieldError: outcome.fieldError,
          },
        };
      case "error":
        active = { owner: current, draft };
        return { outcome };
      case "none":
        return { outcome };
    }
  }

  return {
    discard() {
      active = null;
    },
    handlers: {
      async "draft.start"(params): Promise<Result<"draft.start">> {
        const parent = pathParam(params, "parent");
        const current = running();
        const tree = current.engine.getState().workingTree;
        if (tree === null || findWorkingFolder(tree, parent) === undefined) {
          throw invalidParams();
        }
        active = null;
        events.noteSwitched();
        await current.engine.openNote(null);
        const draft = { parent, name: "" };
        active = { owner: current, draft };
        return { draft };
      },

      async "draft.commitName"(params): Promise<Result<"draft.commitName">> {
        const name = stringParam(params, "name");
        const current = running();
        const stored = activeDraft(current);
        if (stored === null) return { outcome: { kind: "none" } };
        const draft = { parent: stored.parent, name };
        events.noteSwitched();
        const { engine } = current;
        const outcome = commitNoteDraftName(
          engine,
          draft,
          draftSiblingNames(engine.getState().workingTree, draft.parent),
        );
        return settle(current, draft, outcome);
      },

      async "draft.content"(params): Promise<Result<"draft.content">> {
        const name = stringParam(params, "name");
        const content = stringParam(params, "content");
        const current = running();
        const stored = activeDraft(current);
        if (stored === null) return { outcome: { kind: "none" } };
        const draft = { parent: stored.parent, name };
        events.noteSwitched();
        const { engine } = current;
        const outcome = commitNoteDraftContent(
          engine,
          draft,
          content,
          new Date(host.clock.now()),
          draftSiblingNames(engine.getState().workingTree, draft.parent),
        );
        return settle(current, draft, outcome);
      },

      async "draft.leave"(): Promise<Result<"draft.leave">> {
        active = null;
        events.noteSwitched();
        return {};
      },

      async "folder.create"(params): Promise<Result<"folder.create">> {
        const parent = pathParam(params, "parent");
        const name = stringParam(params, "name");
        const result = running().engine.createFolder(parent, name);
        if (!result.ok) {
          return {
            outcome: {
              kind: "error",
              message: describeStructureError(result.error),
            },
          };
        }
        return { outcome: { kind: "created", path: [...result.path] } };
      },
    },
  };
}
