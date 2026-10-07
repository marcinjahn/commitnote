import { writeCachedCornerStyle } from "../session/corner-style-cache";
import type { StorageLike } from "../session/session-store";
import type { CornerStyle } from "../settings/corner-style";

export function setCornerStyleAttribute(
  root: { dataset: DOMStringMap | Record<string, string | undefined> },
  style: CornerStyle,
): void {
  if (style === "square") root.dataset.corners = "square";
  else delete root.dataset.corners;
}

export interface CornerStyleApplier {
  applyCornerStyle(style: CornerStyle): void;
}

export function createCornerStyleApplier(
  root: { dataset: DOMStringMap | Record<string, string | undefined> },
  options: { storage?: StorageLike | null; override?: CornerStyle | null } = {},
): CornerStyleApplier {
  const { override } = options;
  if (override) {
    setCornerStyleAttribute(root, override);
    return { applyCornerStyle() {} };
  }

  let appliedStyle: CornerStyle | null = null;
  return {
    applyCornerStyle(style) {
      setCornerStyleAttribute(root, style);
      if (style !== appliedStyle) writeCachedCornerStyle(style, options.storage);
      appliedStyle = style;
    },
  };
}
