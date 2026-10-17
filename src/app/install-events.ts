export interface InstallChoice {
  outcome: "accepted" | "dismissed";
}

export interface DeferredInstallPrompt {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<InstallChoice>;
}

export interface InstallEvents {
  deferredPrompt(): DeferredInstallPrompt | null;
  installed(): boolean;
  takePrompt(): DeferredInstallPrompt | null;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function captureInstallEvents(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
): InstallEvents {
  let deferred: DeferredInstallPrompt | null = null;
  let installed = false;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  const onBeforeInstallPrompt = (event: Event): void => {
    event.preventDefault();
    deferred = event as unknown as DeferredInstallPrompt;
    notify();
  };

  const onAppInstalled = (): void => {
    installed = true;
    deferred = null;
    notify();
  };

  target.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  target.addEventListener("appinstalled", onAppInstalled);

  return {
    deferredPrompt: () => deferred,
    installed: () => installed,
    takePrompt() {
      const taken = deferred;
      if (!taken) return null;
      deferred = null;
      notify();
      return taken;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      target.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      target.removeEventListener("appinstalled", onAppInstalled);
    },
  };
}
