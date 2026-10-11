import type { PlatformInputs } from "../settings/device-name";

export function readPlatformInputs(standalone: boolean): PlatformInputs {
  return {
    desktopShell: __DESKTOP_SHELL__,
    standalone,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  };
}
