export interface LifecycleTargets {
  readonly window: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly document: Pick<
    Document,
    "addEventListener" | "removeEventListener" | "visibilityState"
  >;
}

export interface LifecycleHandlers {
  readonly flush: () => void;
  readonly retryNow: () => void;
  readonly hasUnsaved: () => boolean;
  readonly setOnline: (online: boolean) => void;
  readonly setVisible: (visible: boolean) => void;
  readonly refreshTrigger: (trigger: "visible" | "online") => void;
}

export function installLifecycleTriggers(
  targets: LifecycleTargets,
  handlers: LifecycleHandlers,
): () => void {
  const { window, document } = targets;

  function handleVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      handlers.setVisible(false);
      handlers.flush();
    } else {
      handlers.setVisible(true);
      handlers.refreshTrigger("visible");
    }
  }

  function handleFocus(): void {
    if (document.visibilityState === "visible") {
      handlers.refreshTrigger("visible");
    }
  }

  function handlePageHide(): void {
    handlers.flush();
  }

  function handleOffline(): void {
    handlers.setOnline(false);
  }

  function handleOnline(): void {
    handlers.setOnline(true);
    handlers.retryNow();
    handlers.refreshTrigger("online");
  }

  function handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (!handlers.hasUnsaved()) return;
    event.preventDefault();
    event.returnValue = "";
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", handleFocus);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("offline", handleOffline);
  window.addEventListener("online", handleOnline);
  window.addEventListener("beforeunload", handleBeforeUnload);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("focus", handleFocus);
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener("offline", handleOffline);
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
}
