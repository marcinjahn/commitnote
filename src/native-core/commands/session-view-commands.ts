import {
  confirmEarlyDraftName,
  emptyEarlyDraft,
  planEarlyDraftHandoff,
  withEarlyDraftBody,
  withEarlyDraftName,
} from "../../app/early-draft";
import { lastViewOf, restorableLastView } from "../../app/last-view";
import type { CoreCommands, EarlyDraftOutcome } from "../api";
import type { AppSession } from "../app-session";
import type { EngineEvents } from "../engine-events";
import type { HostServices } from "../host-services";
import {
  booleanParam,
  invalidParams,
  notReady,
  pathParam,
  stringParam,
  type CommandHandler,
  type CommandParams,
} from "./command-context";
import type { DraftCommands } from "./draft-commands";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

function foldersParam(params: CommandParams): string[][] {
  const value = params.folders;
  if (!Array.isArray(value)) throw invalidParams();
  return value.map((_, index) => pathParam({ path: value[index] }, "path"));
}

function notePathParam(params: CommandParams): string[] | null {
  return params.note === null ? null : pathParam(params, "note");
}

export function createSessionViewCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly drafts: Pick<DraftCommands, "handlers">;
}): Record<string, CommandHandler> {
  const { host, app, events, drafts } = context;

  function running() {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  async function handOff(
    name: string,
    body: string,
    nameConfirmed: boolean,
  ): Promise<EarlyDraftOutcome> {
    const now = host.clock.now();
    const caret = { anchor: 0, head: 0 };
    let early = withEarlyDraftName(emptyEarlyDraft(), name, caret);
    if (nameConfirmed) early = confirmEarlyDraftName(early);
    early = withEarlyDraftBody(early, body, caret, now);
    const plan = planEarlyDraftHandoff(early);
    if (plan.kind === "untouched") return { kind: "none" };

    await drafts.handlers["draft.start"]!({ parent: [] });
    if (plan.kind === "name") return { kind: "draft", name, error: null };

    const { outcome } = (
      plan.kind === "content"
        ? await drafts.handlers["draft.content"]!({
            name: plan.name,
            content: plan.body,
          })
        : await drafts.handlers["draft.commitName"]!({ name: plan.name })
    ) as Result<"draft.content">;
    switch (outcome.kind) {
      case "created":
        return outcome;
      case "error":
        return { kind: "draft", name, error: outcome.message };
      case "none":
        return { kind: "draft", name, error: null };
    }
  }

  return {
    async "lastView.load"(): Promise<Result<"lastView.load">> {
      const current = running();
      const store = app.lastView();
      if (store === null) return { view: null };
      if (!store.isEnabled()) {
        store.setEnabled(true, lastViewOf(null, []));
      }
      const stored = await store.load();
      if (stored === null) return { view: null };
      const tree = current.engine.getState().workingTree;
      const view = tree === null ? stored : restorableLastView(stored, tree);
      return {
        view: {
          note: view.note === null ? null : [...view.note],
          folders: view.folders.map((folder) => [...folder]),
        },
      };
    },

    async "lastView.save"(params): Promise<Result<"lastView.save">> {
      running();
      const view = lastViewOf(notePathParam(params), foldersParam(params));
      const store = app.lastView();
      if (store === null) return {};
      if (store.isEnabled()) store.save(view);
      else store.setEnabled(true, view);
      return {};
    },

    async "earlyDraft.handOff"(params): Promise<Result<"earlyDraft.handOff">> {
      const name = stringParam(params, "name");
      const body = stringParam(params, "body");
      const nameConfirmed = booleanParam(params, "nameConfirmed");
      running();
      return { outcome: await handOff(name, body, nameConfirmed) };
    },
  };
}
