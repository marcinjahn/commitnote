import { conflictSideLabel } from "../../merge/conflict-labels";

export function conflictBannerHeading(otherDevice: string | null): string {
  return otherDevice === null
    ? "This note was changed on another device too"
    : `This note was also changed on ${otherDevice}`;
}

export const CONFLICT_BANNER_TEXT =
  "This device and the other device changed the same lines. Choose which version to keep, or edit the merged text.";

function withName(label: string, name: string | null): string {
  return name === null ? label : `${label} (${name})`;
}

export function keepThisDeviceLabel(name: string | null): string {
  return withName("Keep this device's version", name);
}

export function keepOtherDeviceLabel(name: string | null): string {
  return withName("Keep other device's version", name);
}

export function conflictLegendLabel(
  side: "mine" | "theirs",
  deviceName: string | null,
): string {
  return conflictSideLabel(side, deviceName);
}

export const CONFLICT_EDIT_MERGED_LABEL = "Edit merged";

export const CONFLICT_EDIT_HINT =
  "Remove every conflict marker line (<<<<<<<, =======, >>>>>>>) to finish. Changes are saved once no markers remain.";
