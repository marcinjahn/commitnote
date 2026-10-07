export const MAX_SHARE_LABEL_LENGTH = 100;

export type ShareLabelResult =
  | { readonly ok: true; readonly label: string | null }
  | { readonly ok: false; readonly error: "tooLong" };

export function normalizeShareLabel(raw: string): ShareLabelResult {
  const normalized = raw.trim().normalize("NFC");
  if (normalized === "") return { ok: true, label: null };
  if (normalized.length > MAX_SHARE_LABEL_LENGTH) {
    return { ok: false, error: "tooLong" };
  }
  return { ok: true, label: normalized };
}
