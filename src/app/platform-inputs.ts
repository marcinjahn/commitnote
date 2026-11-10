import type { PlatformInputs } from "../settings/device-name";

export function readPlatformInputs(standalone: boolean): PlatformInputs {
  return {
    standalone,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  };
}
