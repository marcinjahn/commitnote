import { readSharedVersion } from "../../app/shared-version";
import { findWorkingNode } from "../../sync/working-tree";
import {
  describeShareError,
  describeShareUpdate,
  LINK_REVOKED_TEXT,
  messageText,
  shareDialogTitle,
} from "../../ui/share/share-messages";
import type { ActionNotices } from "../action-notices";
import type { CoreCommands } from "../api";
import type { AppSession, NativeRunningApp } from "../app-session";
import type { EngineEvents } from "../engine-events";
import {
  invalidParams,
  notReady,
  pathParam,
  stringParam,
  type CommandHandler,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

export function createShareCommands(context: {
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly notices: ActionNotices;
}): Record<string, CommandHandler> {
  const { app, events, notices } = context;

  function running(): NativeRunningApp {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  const forgeOf = (owner: NativeRunningApp) => owner.session.coordinates.forge;

  return {
    async "share.form"(params): Promise<Result<"share.form">> {
      const path = pathParam(params, "path");
      const { workingTree } = running().engine.getState();
      if (
        path.length === 0 ||
        workingTree === null ||
        findWorkingNode(workingTree, path)?.kind !== "note"
      ) {
        throw invalidParams();
      }
      return { title: shareDialogTitle(path[path.length - 1]!) };
    },

    async "share.create"(params): Promise<Result<"share.create">> {
      const path = pathParam(params, "path");
      const password = stringParam(params, "password");
      const label = stringParam(params, "label");
      const owner = running();
      const result = await owner.services.shareService.createShare({
        path,
        password,
        label,
      });
      if (result.ok) {
        return {
          outcome: {
            kind: "created",
            link: result.link,
            password: result.password,
          },
        };
      }
      return {
        outcome: {
          kind: "error",
          parts: [...describeShareError(result.error, forgeOf(owner))],
        },
      };
    },

    async "share.update"(params): Promise<Result<"share.update">> {
      const id = stringParam(params, "id");
      const owner = running();
      if (events.updatingShare() !== null) return {};
      events.setUpdatingShare(id);
      try {
        const result = await owner.services.shareService.updateShare(id);
        if (app.current() === owner) {
          const { tone, text } = describeShareUpdate(result, forgeOf(owner));
          notices.show(owner, "share", tone, text);
        }
      } finally {
        if (app.current() === owner) events.setUpdatingShare(null);
      }
      return {};
    },

    async "share.rename"(params): Promise<Result<"share.rename">> {
      const id = stringParam(params, "id");
      const label = stringParam(params, "label");
      const owner = running();
      const result = owner.services.shareService.setShareLabel(id, label);
      return {
        outcome: result.ok
          ? { kind: "ok" }
          : {
              kind: "error",
              message: messageText(
                describeShareError(result.error, forgeOf(owner)),
              ),
            },
      };
    },

    async "share.revoke"(params): Promise<Result<"share.revoke">> {
      const id = stringParam(params, "id");
      const owner = running();
      const result = await owner.services.shareService.revokeShare(id);
      if (app.current() !== owner) return {};
      if (result.ok) {
        notices.show(owner, "share", "success", LINK_REVOKED_TEXT);
      } else {
        notices.show(
          owner,
          "share",
          "error",
          messageText(describeShareError(result.error, forgeOf(owner))),
        );
      }
      return {};
    },

    async "share.sharedVersion"(
      params,
    ): Promise<Result<"share.sharedVersion">> {
      const id = stringParam(params, "id");
      const owner = running();
      const entry = owner.engine.getState().shares?.entries.get(id);
      if (entry === undefined) {
        return {
          outcome: {
            kind: "message",
            message: messageText(
              describeShareError({ kind: "shareGone" }, forgeOf(owner)),
            ),
          },
        };
      }
      return {
        outcome: await readSharedVersion(
          {
            noteHistory: owner.services.noteHistory,
            forgeName: app.activeForgeName(),
          },
          entry,
        ),
      };
    },
  };
}
