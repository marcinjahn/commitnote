import { applySavedColorMode } from "./color-mode";

try {
  applySavedColorMode(localStorage, document);
} catch {}

try {
  if (matchMedia("(prefers-reduced-motion: no-preference)").matches) {
    document.documentElement.dataset.motion = "";
  }
} catch {}
