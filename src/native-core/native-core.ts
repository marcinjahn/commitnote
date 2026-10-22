import type { ForgeRegistry } from "../forge/registry";
import type {
  CoreError,
  CoreEventMessage,
  CoreResponse,
  NativeCoreHandle,
} from "./api";
import { createActionNotices } from "./action-notices";
import { createAppSession, type AppSession } from "./app-session";
import {
  CoreCommandError,
  type CommandHandler,
  type CommandParams,
  type EmitCoreEvent,
} from "./commands/command-context";
import { createDraftCommands } from "./commands/draft-commands";
import { createEditingCommands } from "./commands/editing-commands";
import { createLoginCommands } from "./commands/login-commands";
import { createNoteViewCommands } from "./commands/note-view-commands";
import { createNotesCommands } from "./commands/notes-commands";
import { createSessionCommands } from "./commands/session-commands";
import { createSessionViewCommands } from "./commands/session-view-commands";
import { createSearchCommands } from "./commands/search-commands";
import { createStructureCommands } from "./commands/structure-commands";
import { createTrashCommands } from "./commands/trash-commands";
import { coreLevelError } from "./core-errors";
import { createEngineEvents } from "./engine-events";
import type { HostServices } from "./host-services";

export const UNKNOWN_REQUEST_ID = -1;

const SERIALISED_COMMANDS: ReadonlySet<string> = new Set([
  "login.unlock",
  "login.initialize",
  "session.resume",
  "session.logout",
]);

type ParsedRequest =
  | {
      readonly kind: "valid";
      readonly id: number;
      readonly command: string;
      readonly params: CommandParams;
    }
  | { readonly kind: "invalid"; readonly id: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequest(message: string): ParsedRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return { kind: "invalid", id: UNKNOWN_REQUEST_ID };
  }
  if (!isRecord(parsed) || !Number.isSafeInteger(parsed.id)) {
    return { kind: "invalid", id: UNKNOWN_REQUEST_ID };
  }
  const id = parsed.id as number;
  if (typeof parsed.command !== "string" || !isRecord(parsed.params)) {
    return { kind: "invalid", id };
  }
  return { kind: "valid", id, command: parsed.command, params: parsed.params };
}

type ExtraCommands = Record<string, (params: unknown) => Promise<unknown>>;

export function createNativeCore(options: {
  readonly host: HostServices;
  readonly deviceModel: string;
  readonly registry: () => Promise<ForgeRegistry>;
  readonly extraCommands?: ExtraCommands | ((app: AppSession) => ExtraCommands);
}): NativeCoreHandle {
  const { host } = options;
  let stopped = false;

  function post(message: CoreResponse | CoreEventMessage): void {
    if (stopped) return;
    host.post(JSON.stringify(message));
  }

  const emit: EmitCoreEvent = (event, payload) => {
    post({ kind: "event", event, payload });
  };

  const app = createAppSession({
    host,
    deviceModel: options.deviceModel,
    registry: options.registry,
    emit,
  });

  const engineEvents = createEngineEvents({
    app,
    emit,
    now: () => host.clock.now(),
  });
  const notices = createActionNotices({ app, emit });

  const drafts = createDraftCommands({
    host,
    app,
    events: engineEvents,
  });

  const commands = new Map<string, CommandHandler>(
    Object.entries({
      ...(typeof options.extraCommands === "function"
        ? options.extraCommands(app)
        : options.extraCommands),
      ...createLoginCommands({ host, app, emit }),
      ...createSessionCommands({ host, app, emit, drafts }),
      ...createNotesCommands({ app, events: engineEvents, drafts, notices }),
      ...createEditingCommands({ host, app, events: engineEvents }),
      ...drafts.handlers,
      ...createStructureCommands({ app, events: engineEvents, notices }),
      ...createTrashCommands({ app, events: engineEvents }),
      ...createSearchCommands({ host, app, events: engineEvents, emit }),
      ...createNoteViewCommands({ host, app, events: engineEvents }),
      ...createSessionViewCommands({
        host,
        app,
        events: engineEvents,
        drafts,
      }),
    }),
  );

  let sessionQueue: Promise<unknown> = Promise.resolve();

  function respondError(id: number, error: CoreError): void {
    post({ kind: "response", id, ok: false, error });
  }

  async function run(
    command: string,
    handler: CommandHandler,
    params: CommandParams,
  ): Promise<unknown> {
    if (!SERIALISED_COMMANDS.has(command)) return handler(params);
    const result = sessionQueue.then(() => handler(params));
    sessionQueue = result.catch(() => undefined);
    return result;
  }

  async function handle(message: string): Promise<void> {
    const request = parseRequest(message);
    if (request.kind === "invalid") {
      respondError(request.id, coreLevelError("invalidParams"));
      return;
    }
    const { id, command, params } = request;
    const handler = commands.get(command);
    if (handler === undefined) {
      respondError(id, coreLevelError("unknownCommand"));
      return;
    }
    try {
      const result = await run(command, handler, params);
      post({ kind: "response", id, ok: true, result });
    } catch (error) {
      if (error instanceof CoreCommandError) {
        respondError(id, error.coreError);
        return;
      }
      const name = error instanceof Error ? error.name : typeof error;
      host.log.log("error", `Command ${command} failed: ${name}`);
      respondError(id, coreLevelError("internal"));
    }
  }

  return {
    send(message) {
      if (stopped) return;
      void handle(message);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      engineEvents.dispose();
      notices.dispose();
      void app.dispose().catch(() => undefined);
    },
  };
}
