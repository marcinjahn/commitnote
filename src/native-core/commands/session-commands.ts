import { resumeRemembered } from "../../app/resume-remembered";
import type { ForgeId } from "../../forge/repo-coordinates";
import { describeLoginStep } from "../../ui/login/login-messages";
import type { CoreCommands } from "../api";
import type { AppSession } from "../app-session";
import { toCoreError } from "../core-errors";
import {
  booleanParam,
  notReady,
  type CommandHandler,
  type EmitCoreEvent,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

export function createSessionCommands(context: {
  readonly app: AppSession;
  readonly emit: EmitCoreEvent;
}): Record<string, CommandHandler> {
  const { app, emit } = context;

  return {
    async "session.resume"(): Promise<Result<"session.resume">> {
      if (app.current() !== null) throw notReady();
      const loaded: { forge: ForgeId | null } = { forge: null };
      const result = await resumeRemembered({
        store: app.store,
        loginDeps: await app.loginDeps(),
        onStep: (step) => {
          emit("loadingProgress", { step, message: describeLoginStep(step) });
        },
        onSessionLoaded: async (session) => {
          loaded.forge = session.coordinates.forge;
        },
        async clearAfterFailure(session) {
          if (session !== null) await app.store.clear();
          await app.blobStore.deleteAll();
        },
      });
      switch (result.kind) {
        case "none":
          return { kind: "none" };
        case "loggedIn":
          await app.start({
            session: result.session,
            adapter: result.adapter,
            resumed: true,
            ...(result.head === undefined ? {} : { knownHead: result.head }),
          });
          return { kind: "resumed" };
        case "failed":
          return {
            kind: "failed",
            error: toCoreError(result.error, {
              source: "login",
              forgeName:
                loaded.forge === null ? "" : await app.forgeName(loaded.forge),
            }),
            canRetry: result.transient,
          };
      }
    },

    async "session.logout"(): Promise<Result<"session.logout">> {
      const running = app.current();
      if (running === null) {
        await app.blobStore.deleteAll();
      } else {
        running.settingsSaver.flush();
        try {
          await running.engine.flush();
        } catch {
          // Logging out does not wait for unsaved changes.
        }
        await app.stop({ clearBlobCache: true });
      }
      await app.store.clear();
      emit("sessionEnded", { reason: "loggedOut" });
      return {};
    },

    async "lifecycle.setVisible"(
      params,
    ): Promise<Result<"lifecycle.setVisible">> {
      app.setVisible(booleanParam(params, "visible"));
      return {};
    },

    async "lifecycle.setOnline"(
      params,
    ): Promise<Result<"lifecycle.setOnline">> {
      app.setOnline(booleanParam(params, "online"));
      return {};
    },
  };
}
