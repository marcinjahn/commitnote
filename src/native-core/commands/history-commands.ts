import {
  restoreVersion,
  undoRestore,
  undoRestoreApplies,
  type NoteStateDeps,
  type RestoreGuard,
  type RestoreUndo,
} from "../../app/history-actions";
import { draftSiblingNames } from "../../app/note-draft-actions";
import { notePathEquals } from "../../changes/change";
import type { NoteVersion } from "../../history/note-history";
import { planRestore } from "../../history/plan-restore";
import type { SyncEngine } from "../../sync/sync-engine";
import { describeSyncError } from "../../ui/browse/sync-messages";
import {
  describeRestoreBlock,
  UNDECRYPTABLE_VERSION_MESSAGE,
} from "../../ui/history/history-messages";
import type { ActionNotices } from "../action-notices";
import type { CoreCommands, RestoreVersionOutcome } from "../api";
import type { AppSession, NativeRunningApp } from "../app-session";
import type { EngineEvents } from "../engine-events";
import {
  buildVersionPreview,
  createHistoryViews,
  restoreContext,
  type OpenHistory,
} from "../history-view";
import type { HostServices } from "../host-services";
import {
  booleanParam,
  invalidParams,
  notReady,
  pathParam,
  stringParam,
  type CommandHandler,
  type CommandParams,
  type EmitCoreEvent,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

export interface HistoryCommands {
  readonly handlers: Record<string, CommandHandler>;
  dispose(): void;
}

function siblingNamesOf(
  engine: SyncEngine,
): NoteStateDeps["siblingNames"] {
  return (parent, exclude) =>
    draftSiblingNames(engine.getState().workingTree, parent).filter(
      (name) => name !== exclude,
    );
}

function noteStateDeps(engine: SyncEngine): NoteStateDeps {
  return {
    engine,
    siblingNames: siblingNamesOf(engine),
  };
}

export function createHistoryCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly notices: ActionNotices;
  readonly emit: EmitCoreEvent;
}): HistoryCommands {
  const { host, app, events, notices } = context;
  const views = createHistoryViews({
    app,
    emit: context.emit,
    now: () => host.clock.now(),
  });
  let undoGuard: { readonly id: string; readonly guard: RestoreGuard } | null =
    null;

  const stopListening = app.onEngineState((engine) => {
    const held = undoGuard;
    if (held === null) return;
    if (engine === null) {
      undoGuard = null;
      return;
    }
    if (!undoRestoreApplies(held.guard, engine.getState().openNote)) {
      undoGuard = null;
      notices.clear("history", held.id);
    }
  });

  function running(): NativeRunningApp {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  function loadedVersion(params: CommandParams): {
    readonly history: OpenHistory;
    readonly version: NoteVersion;
  } {
    const sha = stringParam(params, "sha");
    running();
    const history = views.current();
    if (history === null) throw invalidParams();
    const version = views.version(history, sha);
    if (version === null) throw invalidParams();
    return { history, version };
  }

  function offerUndo(
    owner: NativeRunningApp,
    message: string,
    undo: RestoreUndo,
    guard: RestoreGuard | null,
  ): void {
    const id = notices.showUndo(owner, "history", message, async () => {
      const held = undoGuard;
      if (
        held === null ||
        held.id !== id ||
        !undoRestoreApplies(held.guard, owner.engine.getState().openNote)
      ) {
        return { kind: "ok" };
      }
      undoGuard = null;
      const result = undoRestore(noteStateDeps(owner.engine), undo);
      return result.ok
        ? { kind: "ok" }
        : { kind: "error", message: result.message };
    });
    undoGuard = guard === null ? null : { id, guard };
  }

  async function restore(
    params: CommandParams,
  ): Promise<RestoreVersionOutcome> {
    const restoreTitle = booleanParam(params, "restoreTitle");
    const { history, version } = loadedVersion(params);
    const content = await views.readContent(history, version);
    if (views.current() !== history) return { kind: "closed" };
    const { owner, path } = history;
    const plan = planRestore({
      ...restoreContext(owner.engine.getState(), path),
      version: content,
      restoreTitle,
    });
    if (plan.kind === "blocked") {
      if (content.kind === "failed") {
        return {
          kind: "error",
          message: describeSyncError(content.error, app.activeForgeName()),
        };
      }
      if (content.kind === "undecryptable") {
        return { kind: "blocked", message: UNDECRYPTABLE_VERSION_MESSAGE };
      }
      return {
        kind: "blocked",
        message: describeRestoreBlock(plan.reason) ?? "",
      };
    }
    const outcome = await restoreVersion(
      {
        engine: owner.engine,
        siblingNames: siblingNamesOf(owner.engine),
        noteHistory: owner.services.noteHistory,
      },
      {
        path,
        plan,
        version,
        isCurrent: () => views.current() === history,
        now: () => host.clock.now(),
      },
    );
    switch (outcome.kind) {
      case "stale":
        return { kind: "closed" };
      case "error":
        return { kind: "error", message: outcome.message };
      case "restored":
        if (views.current() === history) views.close();
        offerUndo(owner, outcome.message, outcome.undo, outcome.guard);
        return { kind: "restored" };
    }
  }

  const handlers: Record<string, CommandHandler> = {
    async "history.open"(params): Promise<Result<"history.open">> {
      const path = pathParam(params, "path");
      const current = running();
      const open = current.engine.getState().openNote;
      if (
        path.length === 0 ||
        open?.kind !== "loaded" ||
        !notePathEquals(open.path, path)
      ) {
        throw invalidParams();
      }
      await views.open(current, path);
      return {};
    },

    async "history.close"(): Promise<Result<"history.close">> {
      views.close();
      return {};
    },

    async "history.loadMore"(): Promise<Result<"history.loadMore">> {
      running();
      const phase = views.current()?.phase;
      if (phase?.kind === "ready") void phase.cursor.loadMore();
      return {};
    },

    async "history.retry"(): Promise<Result<"history.retry">> {
      running();
      const phase = views.current()?.phase;
      if (phase?.kind === "ready") void phase.cursor.retry();
      return {};
    },

    async "history.preview"(params): Promise<Result<"history.preview">> {
      const restoreTitle = booleanParam(params, "restoreTitle");
      const { history, version } = loadedVersion(params);
      const content = await views.readContent(history, version);
      return {
        preview: buildVersionPreview({
          content,
          context: restoreContext(
            history.owner.engine.getState(),
            history.path,
          ),
          restoreTitle,
          forgeName: app.activeForgeName(),
        }),
      };
    },

    async "history.restore"(params): Promise<Result<"history.restore">> {
      return { outcome: await restore(params) };
    },
  };

  return {
    handlers,
    dispose() {
      stopListening();
      undoGuard = null;
      views.dispose();
    },
  };
}
