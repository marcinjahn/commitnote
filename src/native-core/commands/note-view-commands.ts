import { notePathEquals } from "../../changes/change";
import { commitNoteName } from "../../app/structure-actions";
import { isImageId } from "../../images/image-id";
import type { SyncEngine } from "../../sync/sync-engine";
import { findNode } from "../../tree/note-tree";
import { countTasks, countWords } from "../../tree/note-stats";
import {
  describeCreated,
  describeTaskProgress,
  describeUpdated,
  describeWordCount,
} from "../../ui/history/note-details-messages";
import type { CoreCommands } from "../api";
import type { AppSession, NativeRunningApp } from "../app-session";
import { toBase64 } from "../base64";
import type { EngineEvents } from "../engine-events";
import type { HostServices } from "../host-services";
import {
  invalidParams,
  notReady,
  pathParam,
  stringParam,
  type CommandHandler,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

type LoadedNote = Extract<
  NonNullable<ReturnType<SyncEngine["getState"]>["openNote"]>,
  { kind: "loaded" }
>;

export function createNoteViewCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
}): Record<string, CommandHandler> {
  const { host, app, events } = context;

  function running(): NativeRunningApp {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  function loadedNote(current: NativeRunningApp, path: string[]): LoadedNote {
    const open = current.engine.getState().openNote;
    if (open?.kind !== "loaded" || !notePathEquals(open.path, path)) {
      throw invalidParams();
    }
    return open;
  }

  return {
    async "note.rename"(params): Promise<Result<"note.rename">> {
      const path = pathParam(params, "path");
      const name = stringParam(params, "name");
      const { engine } = running();
      if (path.length === 0) throw invalidParams();
      const outcome = commitNoteName(engine, {
        path,
        conflicted: engine
          .getState()
          .conflicts.some((held) => notePathEquals(held.path, path)),
        currentName: path[path.length - 1]!,
        value: name,
      });
      return {
        outcome:
          outcome.kind === "ok"
            ? { kind: "ok", path: [...outcome.path] }
            : outcome,
      };
    },

    async "note.stats"(params): Promise<Result<"note.stats">> {
      const open = loadedNote(running(), pathParam(params, "path"));
      const tasks = countTasks(open.content);
      return {
        words: describeWordCount(countWords(open.content)),
        tasks: tasks.total === 0 ? null : describeTaskProgress(tasks),
      };
    },

    async "note.dates"(params): Promise<Result<"note.dates">> {
      const current = running();
      const open = loadedNote(current, pathParam(params, "path"));
      if (open.blobSha === null) {
        return { notSaved: true, created: null, updated: null };
      }
      const { noteDates } = current.services;
      const cached = noteDates.cached(open.path);
      let dates = cached?.blobSha === open.blobSha ? cached.dates : null;
      if (dates === null) {
        const synced = current.engine.getState().synced;
        const node =
          synced === null ? undefined : findNode(synced.tree, open.path);
        if (
          synced !== null &&
          node?.kind === "note" &&
          node.blobSha === open.blobSha
        ) {
          try {
            dates = await noteDates.resolve(
              open.path,
              synced.head,
              open.blobSha,
            );
          } catch {
            dates = null;
          }
        }
      }
      if (dates === null) return { notSaved: false, created: null, updated: null };
      return {
        notSaved: false,
        created: describeCreated(dates.created),
        updated: describeUpdated(dates.updated, host.clock.now()),
      };
    },

    async "image.read"(params): Promise<Result<"image.read">> {
      const imageId = stringParam(params, "imageId");
      if (!isImageId(imageId)) throw invalidParams();
      const current = running();
      try {
        const payload = await current.services.imageResolver.readPayload(imageId);
        if (payload === null) return { image: null };
        return {
          image: { type: payload.type, base64: toBase64(payload.bytes) },
        };
      } catch {
        return { image: null };
      }
    },
  };
}
