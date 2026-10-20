import type { HostServices } from "../host-services";

export interface BareHostTimers {
  setTimeout(callback: () => void, ms?: number): number;
  clearTimeout(id: number | undefined): void;
  queueMicrotask(callback: () => void): void;
}

export function createTimers(getHost: () => HostServices): BareHostTimers {
  return {
    setTimeout(callback, ms = 0) {
      if (typeof callback !== "function") {
        throw new TypeError("The callback must be a function");
      }
      const delay = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
      return getHost().clock.setTimeout(() => callback(), delay);
    },
    clearTimeout(id) {
      if (id === undefined || id === null) return;
      getHost().clock.clearTimeout(id);
    },
    queueMicrotask(callback) {
      if (typeof callback !== "function") {
        throw new TypeError("The callback must be a function");
      }
      void Promise.resolve().then(() => callback());
    },
  };
}
