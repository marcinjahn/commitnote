import { utf8Encode } from "../crypto/base64";
import { MAX_NAME_BYTES } from "../format/v1";

export type NameError =
  | { readonly kind: "empty" }
  | { readonly kind: "containsSlash" }
  | { readonly kind: "dotName" }
  | { readonly kind: "tooLong"; readonly maxBytes: number }
  | { readonly kind: "duplicate" };

export type NameValidation =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly error: NameError };

export function validateName(
  input: string,
  siblingNames: readonly string[],
): NameValidation {
  const normalized = input.trim().normalize("NFC");

  if (normalized.length === 0) {
    return { ok: false, error: { kind: "empty" } };
  }
  if (normalized.includes("/")) {
    return { ok: false, error: { kind: "containsSlash" } };
  }
  if (normalized === "." || normalized === "..") {
    return { ok: false, error: { kind: "dotName" } };
  }
  if (utf8Encode(normalized).length > MAX_NAME_BYTES) {
    return {
      ok: false,
      error: { kind: "tooLong", maxBytes: MAX_NAME_BYTES },
    };
  }
  if (siblingNames.some((sibling) => sibling === normalized)) {
    return { ok: false, error: { kind: "duplicate" } };
  }

  return { ok: true, name: normalized };
}

const collator = new Intl.Collator(undefined, { sensitivity: "accent" });

export function compareNames(a: string, b: string): number {
  const primary = collator.compare(a, b);
  if (primary !== 0) return primary;
  // The collator treats case-only differences as ties; break them by
  // code-unit order so the result stays deterministic.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
