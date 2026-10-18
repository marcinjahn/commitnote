export interface DisplayModeEnvironment {
  matchMedia(query: string): { matches: boolean };
  navigator: { standalone?: boolean };
}

export const STANDALONE_DISPLAY_MODES = [
  "standalone",
  "fullscreen",
  "minimal-ui",
  "window-controls-overlay",
] as const;

export function isStandalone(env: DisplayModeEnvironment): boolean {
  if (env.navigator.standalone === true) return true;
  return STANDALONE_DISPLAY_MODES.some(
    (mode) => env.matchMedia(`(display-mode: ${mode})`).matches,
  );
}

export function resolveStandalone(
  desktopShell: boolean,
  environment: DisplayModeEnvironment,
): boolean {
  return desktopShell || isStandalone(environment);
}
