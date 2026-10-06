import type { Clock } from "../../sync/clock";

export const DATES_GRACE_MS = 150;

export type DetailsForm = "pending" | "compact" | "full" | "not-saved";

export interface DatesGraceInput {
  noteSwitch: number;
  notSaved: boolean;
  hasDates: boolean;
}

export interface DatesGraceOptions {
  clock: Clock;
  onForm: (form: DetailsForm) => void;
}

export function createDatesGrace(options: DatesGraceOptions): {
  update(input: DatesGraceInput): void;
  dispose(): void;
} {
  const { clock, onForm } = options;
  let form: DetailsForm | null = null;
  let lastSwitch: number | null = null;
  let timer: unknown = null;
  let disposed = false;

  function setForm(next: DetailsForm): void {
    if (next === form) return;
    form = next;
    onForm(next);
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
      if (disposed) return;
      setForm("compact");
    }, DATES_GRACE_MS);
  }

  function update(input: DatesGraceInput): void {
    if (disposed) return;
    const switched = lastSwitch === null || input.noteSwitch !== lastSwitch;
    lastSwitch = input.noteSwitch;

    if (input.notSaved) {
      cancelTimer();
      setForm("not-saved");
      return;
    }
    if (input.hasDates) {
      cancelTimer();
      setForm("full");
      return;
    }
    if (switched) {
      setForm("pending");
      startTimer();
      return;
    }
    if (form === "not-saved" && timer === null) {
      startTimer();
    }
  }

  function dispose(): void {
    disposed = true;
    cancelTimer();
  }

  return { update, dispose };
}
