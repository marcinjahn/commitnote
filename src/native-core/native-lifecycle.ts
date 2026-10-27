import type { LifecycleHandlers } from "../app/lifecycle-triggers";
import type { ConnectivityPort, VisibilityPort } from "../app/platform-ports";

export interface NativeLifecycle {
  readonly connectivity: ConnectivityPort;
  readonly visibility: VisibilityPort;
  install(handlers: LifecycleHandlers): () => void;
  setVisible(visible: boolean): void;
  setOnline(online: boolean): void;
}

function createFlag(initial: boolean) {
  let value = initial;
  const listeners = new Set<(value: boolean) => void>();
  return {
    get: () => value,
    set(next: boolean): boolean {
      if (next === value) return false;
      value = next;
      for (const listener of [...listeners]) listener(next);
      return true;
    },
    subscribe(listener: (value: boolean) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createNativeLifecycle(): NativeLifecycle {
  const online = createFlag(true);
  const visible = createFlag(true);
  let handlers: LifecycleHandlers | null = null;

  return {
    connectivity: { isOnline: online.get, subscribe: online.subscribe },
    visibility: { isVisible: visible.get, subscribe: visible.subscribe },
    install(installed) {
      handlers = installed;
      return () => {
        if (handlers === installed) handlers = null;
      };
    },
    setVisible(next) {
      if (!visible.set(next) || handlers === null) return;
      if (next) {
        handlers.setVisible(true);
        handlers.refreshTrigger("visible");
      } else {
        handlers.setVisible(false);
        handlers.flush();
      }
    },
    setOnline(next) {
      if (!online.set(next) || handlers === null) return;
      if (next) {
        handlers.setOnline(true);
        handlers.retryNow();
        handlers.refreshTrigger("online");
      } else {
        handlers.setOnline(false);
      }
    },
  };
}
