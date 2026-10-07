export interface OnceGate {
  readonly available: boolean;
  take(): boolean;
}

export function createOnceGate(): OnceGate {
  let taken = false;
  return {
    get available() {
      return !taken;
    },
    take() {
      if (taken) return false;
      taken = true;
      return true;
    },
  };
}

export const typedWordmarkGate: OnceGate = createOnceGate();
