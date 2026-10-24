export const APP_PATH = "/app/";

export const INSTALLED_DISPLAY_MODES = [
  "standalone",
  "minimal-ui",
  "window-controls-overlay",
] as const;

const LAUNCH_ACTIONS: readonly string[] = ["new-note", "search"];

export function appForwardingTarget(
  location: {
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
  },
  installed: boolean,
): string | null {
  if (location.pathname.startsWith(APP_PATH)) return null;
  const action = new URLSearchParams(location.search).get("action");
  const forwards =
    location.hash.startsWith("#share=") ||
    location.hash.startsWith("#n=") ||
    (action !== null && LAUNCH_ACTIONS.includes(action)) ||
    installed;
  return forwards ? APP_PATH + location.search + location.hash : null;
}

export function runsInstalled(
  matchMedia: (query: string) => { readonly matches: boolean },
): boolean {
  return INSTALLED_DISPLAY_MODES.some(
    (mode) => matchMedia(`(display-mode: ${mode})`).matches,
  );
}
