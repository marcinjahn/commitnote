import { removeLastView } from "../../app/last-view";
import { flushBeforeLogOut } from "../../app/log-out";
import { resumeRemembered } from "../../app/resume-remembered";
import { repoKeyOf } from "../../blob-cache/blob-cache";
import type { ForgeId } from "../../forge/repo-coordinates";
import { describeLoginStep } from "../../ui/login/login-messages";
import { describeLogoutUnsaved } from "../../ui/session/session-messages";
import type { CoreCommands } from "../api";
import type { AppSession, NativeRunningApp } from "../app-session";
import { toCoreError } from "../core-errors";
import type { HostServices } from "../host-services";
import type { DraftCommands } from "./draft-commands";
import {
  booleanParam,
  notReady,
  type CommandHandler,
  type EmitCoreEvent,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

async function unsavedCountAfterFlush(running: NativeRunningApp): Promise<number> {
  try {
    const result = await flushBeforeLogOut(running);
    return result.kind === "unsaved" ? result.count : 0;
  } catch {
    return running.engine.getState().syncStates.unsavedCount;
  }
}

export function createSessionCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly emit: EmitCoreEvent;
  readonly drafts: Pick<DraftCommands, "discard">;
}): Record<string, CommandHandler> {
  const { host, app, emit, drafts } = context;

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

    async "session.logout"(params): Promise<Result<"session.logout">> {
      const anyway = booleanParam(params, "anyway");
      const running = app.current();
      if (running === null) {
        await app.blobStore.deleteAll();
      } else {
        if (!anyway) {
          const count = await unsavedCountAfterFlush(running);
          if (count > 0) {
            return {
              outcome: {
                kind: "unsaved",
                count,
                message: describeLogoutUnsaved(count),
              },
            };
          }
        }
        drafts.discard();
        await app.stop({ clearBlobCache: true });
        removeLastView(
          repoKeyOf(running.session.coordinates),
          host.deviceSettings,
        );
      }
      await app.store.clear();
      emit("sessionEnded", { reason: "loggedOut" });
      return { outcome: { kind: "loggedOut" } };
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
