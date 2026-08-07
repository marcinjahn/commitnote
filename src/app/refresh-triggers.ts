export interface RefreshTriggerTargets {
  readonly window: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly document: Pick<
    Document,
    "addEventListener" | "removeEventListener" | "visibilityState"
  >;
}

export function installRefreshTriggers(
  targets: RefreshTriggerTargets,
  refresh: () => void,
): () => void {
  const { window, document } = targets;

  function handleFocus(): void {
    refresh();
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === "visible") {
      refresh();
    }
  }

  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
