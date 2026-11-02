import { createLaunchActions, type LaunchAction } from "../../app/launch-action";
import {
  invalidParams,
  type CommandHandler,
  type CommandParams,
  type EmitCoreEvent,
} from "./command-context";

function isLaunchAction(value: unknown): value is LaunchAction {
  return value === "new-note" || value === "search";
}

function acceptsParam(params: CommandParams): LaunchAction[] {
  const value = params.accepts;
  if (!Array.isArray(value) || !value.every(isLaunchAction)) {
    throw invalidParams();
  }
  return value;
}

export function createLaunchCommands(context: {
  readonly emit: EmitCoreEvent;
}): Record<string, CommandHandler> {
  const { emit } = context;
  const actions = createLaunchActions();
  let detach: (() => void) | null = null;

  function detachCurrent(): void {
    detach?.();
    detach = null;
  }

  return {
    async "launch.deliver"(params) {
      const action = params.action;
      if (!isLaunchAction(action)) throw invalidParams();
      actions.deliver(action);
      return {};
    },
    async "launch.attach"(params) {
      const accepts = acceptsParam(params);
      detachCurrent();
      detach = actions.attach(
        (action) => emit("launchAction", { action }),
        (action) => accepts.includes(action),
      );
      return {};
    },
    async "launch.detach"() {
      detachCurrent();
      return {};
    },
  };
}
