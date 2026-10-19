import {
  LAUNCH_ACTION_PARAM,
  parseLaunchAction,
  type LaunchAction,
  type LaunchActions,
} from "../app/launch-action";

export const DESKTOP_LAUNCH_ACTION_EVENT = "desktop-launch-action";

export function parseDesktopLaunchAction(
  payload: unknown,
): LaunchAction | null {
  if (typeof payload !== "string") return null;
  const url = new URL("https://desktop.invalid/");
  url.searchParams.set(LAUNCH_ACTION_PARAM, payload);
  return parseLaunchAction(url.href);
}

export function forwardDesktopLaunchActions(
  listen: (handler: (payload: unknown) => void) => Promise<() => void>,
  launchActions: Pick<LaunchActions, "deliver">,
): Promise<() => void> {
  return listen((payload) => {
    const action = parseDesktopLaunchAction(payload);
    if (action !== null) launchActions.deliver(action);
  });
}
