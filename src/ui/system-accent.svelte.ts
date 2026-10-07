import {
  FALLBACK_SYSTEM_ACCENT,
  resolveSystemAccent,
  type SystemAccent,
} from "../settings/accent-snap";

const SRGB_ACCENT = "color-mix(in srgb, AccentColor 100%, transparent)";

let current = $state.raw<SystemAccent>(FALLBACK_SYSTEM_ACCENT);
let activeUpdate: (() => void) | null = null;

export function systemAccent(): SystemAccent {
  return current;
}

export function refreshSystemAccent(): void {
  activeUpdate?.();
}

function readOsAccent(win: Window & typeof globalThis): string | null {
  if (!win.CSS.supports("color", "AccentColor")) return null;
  const probe = win.document.createElement("span");
  probe.hidden = true;
  probe.style.color = win.CSS.supports("color", SRGB_ACCENT)
    ? SRGB_ACCENT
    : "AccentColor";
  win.document.body.append(probe);
  const color = win.getComputedStyle(probe).color;
  probe.remove();
  return color;
}

export function watchSystemAccent(win: Window & typeof globalThis): () => void {
  const update = () => {
    const next = resolveSystemAccent(readOsAccent(win));
    if (next.id !== current.id || next.fromOs !== current.fromOs) {
      current = next;
    }
  };
  const onVisibilityChange = () => {
    if (win.document.visibilityState === "visible") update();
  };
  const scheme = win.matchMedia("(prefers-color-scheme: dark)");

  activeUpdate = update;
  update();
  win.addEventListener("focus", update);
  win.document.addEventListener("visibilitychange", onVisibilityChange);
  scheme.addEventListener("change", update);
  return () => {
    if (activeUpdate === update) activeUpdate = null;
    win.removeEventListener("focus", update);
    win.document.removeEventListener("visibilitychange", onVisibilityChange);
    scheme.removeEventListener("change", update);
  };
}
