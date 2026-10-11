import { isIosDevice } from "../app/install-offer";

export const DEVICE_NAME_MAX_LENGTH = 40;

export interface PlatformInputs {
  desktopShell: boolean;
  standalone: boolean;
  userAgent: string;
  maxTouchPoints: number;
}

function osName(inputs: PlatformInputs): string {
  const ua = inputs.userAgent;
  if (isIosDevice(inputs)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "macOS";
  if (/Linux|X11/.test(ua)) return "Linux";
  return "Unknown OS";
}

function browserName(ua: string): string {
  if (/Edg\/|EdgiOS\/|EdgA\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

export function automaticDeviceName(inputs: PlatformInputs): string {
  const os = osName(inputs);
  if (inputs.desktopShell) return `Desktop app on ${os}`;
  if (inputs.standalone) return `${os} app`;
  return `${browserName(inputs.userAgent)} on ${os}`;
}

export function normalizeDeviceName(raw: string): string | null {
  const collapsed = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const capped = Array.from(collapsed)
    .slice(0, DEVICE_NAME_MAX_LENGTH)
    .join("")
    .trim();
  return capped === "" ? null : capped;
}

export function effectiveDeviceName(
  stored: string | null,
  inputs: PlatformInputs,
): string {
  return stored ?? automaticDeviceName(inputs);
}
