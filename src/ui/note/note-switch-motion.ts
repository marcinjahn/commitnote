import type { Clock } from "../../sync/clock";

export const LOADING_REVEAL_DELAY_MS = 400;

export type SwitchTarget = "loading" | "presentable";

export interface NoteSwitchInput {
  noteSwitch: number;
  target: SwitchTarget;
}

export interface NoteSwitchView {
  held: boolean;
  loadingRevealed: boolean;
}

export interface NoteSwitchMotionOptions {
  clock: Clock;
  onView: (view: NoteSwitchView) => void;
  onLeave: () => void;
  onEnter: () => void;
}

export function createNoteSwitchMotion(options: NoteSwitchMotionOptions): {
  update(input: NoteSwitchInput): void;
  dispose(): void;
} {
  const { clock, onView, onLeave, onEnter } = options;
  let view: NoteSwitchView = { held: false, loadingRevealed: false };
  let lastSwitch: number | null = null;
  let target: SwitchTarget = "presentable";
  let entered = true;
  let timer: unknown = null;
  let disposed = false;

  function setView(next: NoteSwitchView): void {
    if (next.held === view.held && next.loadingRevealed === view.loadingRevealed) {
      return;
    }
    view = next;
    onView(view);
  }

  function cancelTimer(): void {
    if (timer === null) return;
    clock.clearTimeout(timer);
    timer = null;
  }

  function startTimer(): void {
    cancelTimer();
    timer = clock.setTimeout(() => {
      timer = null;
      if (disposed || target !== "loading") return;
      setView({ held: view.held, loadingRevealed: true });
    }, LOADING_REVEAL_DELAY_MS);
  }

  function settle(): void {
    cancelTimer();
    setView({ held: false, loadingRevealed: false });
  }

  function update(input: NoteSwitchInput): void {
    if (disposed) return;
    const previousTarget = target;
    const baseline = lastSwitch === null;
    const switched = !baseline && input.noteSwitch !== lastSwitch;
    lastSwitch = input.noteSwitch;
    target = input.target;

    if (switched) {
      if (target === "presentable") {
        settle();
        entered = true;
        onEnter();
      } else {
        entered = false;
        setView({ held: true, loadingRevealed: false });
        onLeave();
        startTimer();
      }
      return;
    }

    if (target === "loading") {
      if ((baseline || previousTarget === "presentable") && !view.held) {
        startTimer();
      }
      return;
    }

    if (previousTarget === "loading") {
      settle();
      if (!entered) {
        entered = true;
        onEnter();
      }
    }
  }

  function dispose(): void {
    disposed = true;
    cancelTimer();
  }

  return { update, dispose };
}
