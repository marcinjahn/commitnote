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
}

export function installLifecycleTriggers(
  targets: LifecycleTargets,
  handlers: LifecycleHandlers,
): () => void {
  const { window, document } = targets;

  function handleVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      handlers.flush();
    }
  }

  function handlePageHide(): void {
    handlers.flush();
  }

  function handleOnline(): void {
    handlers.retryNow();
  }

  function handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (!handlers.hasUnsaved()) return;
    event.preventDefault();
    event.returnValue = "";
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("online", handleOnline);
  window.addEventListener("beforeunload", handleBeforeUnload);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
}
