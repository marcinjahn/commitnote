import type { ActionNotices } from "../action-notices";
import type { CoreCommands } from "../api";
import type { AppSession } from "../app-session";
import type { EngineEvents } from "../engine-events";
import type { HostServices } from "../host-services";
import { notReady, type CommandHandler } from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

export function createPrintCommands(_context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly notices: ActionNotices;
}): Record<string, CommandHandler> {
  return {
    async "print.render"(): Promise<Result<"print.render">> {
      throw notReady();
    },
  };
}
