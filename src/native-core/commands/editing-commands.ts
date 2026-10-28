import { buildNotesArchive } from "../../export/notes-archive";
import { exportFileName } from "../../export/export-file-name";
import type { CoreCommands, ConflictResolution } from "../api";
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

const RESOLUTIONS: readonly ConflictResolution[] = [
  "keepMine",
  "keepTheirs",
  "editMerged",
];
const BASE64_CHUNK_BYTES = 0x6000;

function notePath(params: CommandParams): string[] {
  const value = params.path;
  if (!Array.isArray(value) || !value.every((s) => typeof s === "string")) {
    throw invalidParams();
  }
  return value as string[];
}

function resolutionParam(params: CommandParams): ConflictResolution {
  const value = params.resolution;
  const found = RESOLUTIONS.find((resolution) => resolution === value);
  if (found === undefined) throw invalidParams();
  return found;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

export function createEditingCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
}): Record<string, CommandHandler> {
  const { host, app, events } = context;

  function running() {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  return {
    async "note.edit"(params): Promise<Result<"note.edit">> {
      const path = notePath(params);
      const text = stringParam(params, "text");
      running().engine.editNote(path, text);
      return {};
    },
    async "sync.flush"(): Promise<Result<"sync.flush">> {
      const current = app.current();
      if (current === null) return { result: { kind: "saved" } };
      events.attach(current);
      current.settingsSaver.flush();
      return { result: await current.engine.flush() };
    },
    async "sync.retry"(): Promise<Result<"sync.retry">> {
      running().engine.retryNow();
      return {};
    },
    async "conflict.resolve"(params): Promise<Result<"conflict.resolve">> {
      const path = notePath(params);
      const resolution = resolutionParam(params);
      running().engine.resolveConflict(path, resolution);
      return {};
    },
    async "export.notes"(): Promise<Result<"export.notes">> {
      const snapshot = running().engine.snapshotNotes();
      if (snapshot === null) throw notReady();
      const now = new Date(host.clock.now());
      const archive = await buildNotesArchive(
        snapshot.tree.root,
        snapshot.readNote,
        now,
      );
      return {
        fileName: exportFileName(now),
        mimeType: "application/zip",
        base64: toBase64(archive),
      };
    },
  };
}
