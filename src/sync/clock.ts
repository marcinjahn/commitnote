export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now(): number {
    return Date.now();
  },
  setTimeout(callback: () => void, ms: number): unknown {
    // Called through globalThis rather than passed by reference, so the
    // receiver stays globalThis instead of this Clock object.
    return globalThis.setTimeout(callback, ms);
  },
  clearTimeout(handle: unknown): void {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};
