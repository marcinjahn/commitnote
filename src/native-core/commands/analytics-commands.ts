import type { CoreCommands } from "../api";
import type { AppSession } from "../app-session";
import { nativeVisitUrl } from "../native-visit";
import { type CommandHandler } from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

export function createAnalyticsCommands(context: {
  readonly analyticsEndpoint: string | null;
  readonly app: AppSession;
}): Record<string, CommandHandler> {
  return {
    async "analytics.visit"(): Promise<Result<"analytics.visit">> {
      return {
        url: nativeVisitUrl(context.analyticsEndpoint, context.app.platform),
      };
    },
  };
}
