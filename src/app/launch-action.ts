export type LaunchAction = "new-note" | "search";

export const LAUNCH_ACTION_PARAM = "action";

export function parseLaunchAction(url: string): LaunchAction | null {
  let value: string | null;
  try {
    value = new URL(url).searchParams.get(LAUNCH_ACTION_PARAM);
  } catch {
    return null;
  }
  return value === "new-note" || value === "search" ? value : null;
}

function hasLaunchActionParam(url: string): boolean {
  try {
    return new URL(url).searchParams.has(LAUNCH_ACTION_PARAM);
  } catch {
    return false;
  }
}

export interface LaunchParamsLike {
  readonly targetURL?: string | null;
}

export interface LaunchQueueLike {
  setConsumer(consumer: (params: LaunchParamsLike) => void): void;
}

export interface LaunchActions {
  deliver(action: LaunchAction): void;
  attach(run: (action: LaunchAction) => void): () => void;
}

export function createLaunchActions(): LaunchActions {
  let pending: LaunchAction | null = null;
  let handler: ((action: LaunchAction) => void) | null = null;

  return {
    deliver(action) {
      if (handler) handler(action);
      else pending = action;
    },
    attach(run) {
      handler = run;
      if (pending !== null) {
        const action = pending;
        pending = null;
        run(action);
      }
      return () => {
        if (handler === run) handler = null;
      };
    },
  };
}

export function startLaunchActions(env: {
  bootHref: string;
  launchQueue: LaunchQueueLike | undefined;
  clearUrl(): void;
}): LaunchActions {
  const actions = createLaunchActions();
  const bootAction = parseLaunchAction(env.bootHref);
  if (bootAction !== null) actions.deliver(bootAction);
  if (hasLaunchActionParam(env.bootHref)) env.clearUrl();

  let first = true;
  env.launchQueue?.setConsumer((params) => {
    const target = params.targetURL;
    if (!target) return;
    const isFirst = first;
    first = false;
    if (isFirst && target === env.bootHref) return;
    const action = parseLaunchAction(target);
    if (action !== null) actions.deliver(action);
  });
  return actions;
}
