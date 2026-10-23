import type { ActionNotices } from "../action-notices";
import type { CoreCommands } from "../api";
import type { AppSession } from "../app-session";
import type { EngineEvents } from "../engine-events";
import type { HostServices } from "../host-services";
import { notReady, type CommandHandler } from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

export function createPassphraseCommands(_context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly notices: ActionNotices;
}): Record<string, CommandHandler> {
  return {
    async "passphrase.changeForm"(): Promise<Result<"passphrase.changeForm">> {
      throw notReady();
    },
    async "passphrase.prepareChange"(): Promise<Result<"passphrase.prepareChange">> {
      throw notReady();
    },
    async "passphrase.commitChange"(): Promise<Result<"passphrase.commitChange">> {
      throw notReady();
    },
    async "passphrase.settle"(): Promise<Result<"passphrase.settle">> {
      throw notReady();
    },
    async "passphrase.cancelChange"(): Promise<Result<"passphrase.cancelChange">> {
      throw notReady();
    },
    async "passphrase.enableAtomic"(): Promise<Result<"passphrase.enableAtomic">> {
      throw notReady();
    },
  };
}
