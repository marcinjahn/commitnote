export const THIS_DEVICE_LABEL = "This device";
export const OTHER_DEVICE_LABEL = "Other device";
export const CONFLICT_LABEL_SEPARATOR = " · ";

export interface ConflictMarkerLabels {
  readonly mine: string;
  readonly theirs: string;
}

export const PLAIN_CONFLICT_LABELS: ConflictMarkerLabels = {
  mine: THIS_DEVICE_LABEL,
  theirs: OTHER_DEVICE_LABEL,
};

export function conflictSideLabel(
  side: "mine" | "theirs",
  deviceName: string | null,
): string {
  const base = side === "mine" ? THIS_DEVICE_LABEL : OTHER_DEVICE_LABEL;
  return deviceName === null ? base : `${base}${CONFLICT_LABEL_SEPARATOR}${deviceName}`;
}
