import type { Clock } from "../sync/clock";
import type { StorageLike } from "../session/session-store";
import { type AppUpdates, UPDATE_CHECK_INTERVAL_MS } from "./app-updates";

export const LAUNCH_WINDOW_MS = 10_000;
export const IDLE_APPLY_MS = 60_000;
export const RELOAD_GUARD_MS = 60_000;

const RELOAD_GUARD_KEY = "commitnote.updateReloadAt";

export interface AutoUpdateHost {
  hasUnsaved(): boolean;
  canReload(): boolean;
  overlayOpen(): boolean;
  editing(): boolean;
  hidden(): boolean;
  prepareReload(): Promise<void>;
}

export interface UpdateView {
  busy(): boolean;
  saveResume(): Promise<void>;
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export function isEditableElement(element: Element | null): boolean {
  if (element === null) return false;
  if ((element as HTMLElement).isContentEditable === true) return true;
  if (element.tagName === "TEXTAREA") {
    return !(element as HTMLTextAreaElement).readOnly;
  }
  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement;
    return !input.readOnly && !NON_TEXT_INPUT_TYPES.has(input.type);
  }
  return false;
}

export interface ReloadGuard {
  msUntilAllowed(): number;
  recordReload(): void;
}

export interface AutoUpdateDeps {
  updates: Pick<
    AppUpdates,
    "updateWaiting" | "controllerChanged" | "subscribe" | "skipWaiting" | "checkForUpdate"
  >;
  host: AutoUpdateHost;
  clock: Clock;
  reloadGuard: ReloadGuard;
  reload(): void;
}

export interface AutoUpdate {
  noteInput(): void;
  evaluate(): void;
  dispose(): void;
}

export function createAutoUpdate(deps: AutoUpdateDeps): AutoUpdate {
  const { updates, host, clock, reloadGuard } = deps;
  const startedAt = clock.now();
  let lastInputAt: number | null = null;
  let applying = false;
  let disposed = false;
  let wakeTimer: unknown = null;
  let checkTimer: unknown = null;

  function pending(): boolean {
    return updates.controllerChanged || updates.updateWaiting;
  }

  function inLaunchWindow(): boolean {
    return lastInputAt === null && clock.now() - startedAt < LAUNCH_WINDOW_MS;
  }

  function idleDueIn(): number {
    return Math.max(0, (lastInputAt ?? startedAt) + IDLE_APPLY_MS - clock.now());
  }

  function safe(): boolean {
    if (host.hasUnsaved() || host.overlayOpen()) return false;
    if (inLaunchWindow() && !host.editing()) return true;
    if (!host.canReload()) return false;
    if (host.hidden()) return true;
    return idleDueIn() === 0 && !host.editing();
  }

  function wakeIn(ms: number): void {
    if (wakeTimer !== null) clock.clearTimeout(wakeTimer);
    wakeTimer = clock.setTimeout(() => {
      wakeTimer = null;
      evaluate();
    }, ms);
  }

  function waitForSafeMoment(): void {
    const due = idleDueIn();
    if (due > 0) wakeIn(due);
  }

  function evaluate(): void {
    if (disposed || applying || !pending()) return;
    if (!safe()) {
      waitForSafeMoment();
      return;
    }
    if (!updates.controllerChanged) {
      updates.skipWaiting();
      return;
    }
    const blockedFor = reloadGuard.msUntilAllowed();
    if (blockedFor > 0) {
      wakeIn(blockedFor);
      return;
    }
    applying = true;
    void host
      .prepareReload()
      .catch(() => undefined)
      .then(() => {
        if (disposed) return;
        if (!safe()) {
          applying = false;
          waitForSafeMoment();
          return;
        }
        reloadGuard.recordReload();
        deps.reload();
      });
  }

  function scheduleCheck(): void {
    checkTimer = clock.setTimeout(() => {
      updates.checkForUpdate();
      scheduleCheck();
    }, UPDATE_CHECK_INTERVAL_MS);
  }

  const unsubscribe = updates.subscribe(evaluate);
  scheduleCheck();
  evaluate();

  return {
    noteInput() {
      lastInputAt = clock.now();
      if (pending() && !applying) waitForSafeMoment();
    },
    evaluate,
    dispose() {
      disposed = true;
      unsubscribe();
      if (wakeTimer !== null) clock.clearTimeout(wakeTimer);
      if (checkTimer !== null) clock.clearTimeout(checkTimer);
    },
  };
}

export function createReloadGuard(
  storage: StorageLike | null,
  clock: Pick<Clock, "now">,
): ReloadGuard {
  return {
    msUntilAllowed() {
      let raw: string | null = null;
      try {
        raw = storage?.getItem(RELOAD_GUARD_KEY) ?? null;
      } catch {
        return 0;
      }
      const at = raw === null ? NaN : Number(raw);
      const now = clock.now();
      if (!Number.isFinite(at) || at > now) return 0;
      return Math.max(0, at + RELOAD_GUARD_MS - now);
    },
    recordReload() {
      try {
        storage?.setItem(RELOAD_GUARD_KEY, String(clock.now()));
      } catch {
        // Without storage the guard cannot hold; the reload still goes ahead.
      }
    },
  };
}

const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

export interface AutoUpdateTargets {
  readonly window: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly document: Pick<Document, "addEventListener" | "removeEventListener">;
}

export function installAutoUpdate(
  targets: AutoUpdateTargets,
  deps: AutoUpdateDeps,
): AutoUpdate {
  const auto = createAutoUpdate(deps);
  const { window, document } = targets;
  const onInput = () => auto.noteInput();
  const onFocusChange = () => {
    deps.clock.setTimeout(() => auto.evaluate(), 0);
  };
  const options = { capture: true, passive: true };
  for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, options);
  document.addEventListener("visibilitychange", auto.evaluate);
  document.addEventListener("focusout", onFocusChange);
  window.addEventListener("blur", onFocusChange);
  return {
    noteInput: auto.noteInput,
    evaluate: auto.evaluate,
    dispose() {
      auto.dispose();
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, options);
      document.removeEventListener("visibilitychange", auto.evaluate);
      document.removeEventListener("focusout", onFocusChange);
      window.removeEventListener("blur", onFocusChange);
    },
  };
}
