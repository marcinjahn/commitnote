import { prefersReducedMotion } from "../browse/drag-motion";
import { typedWordmarkGate } from "./once-gate";
import { createTypingSchedule } from "./typing-schedule";

export type TypingPhase = "typing" | "blinking" | "done";

export const FONT_WAIT_MS = 300;

export interface TypedWordmarkCallbacks {
  onStart(): void;
  onType(count: number): void;
  onBlink(): void;
  onCaret(visible: boolean): void;
  onDone(): void;
}

export function initialTypingPhase(): TypingPhase {
  if (!typedWordmarkGate.available) return "done";
  if (prefersReducedMotion()) {
    typedWordmarkGate.take();
    return "done";
  }
  return "typing";
}

export function driveTypedWordmark(
  element: HTMLElement,
  text: string,
  beatBeforeIndex: number,
  callbacks: TypedWordmarkCallbacks,
): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;

  function later(
    run: () => void,
    delay: number,
  ): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      timers.delete(id);
      run();
    }, delay);
    timers.add(id);
    return id;
  }

  function cancel(id: ReturnType<typeof setTimeout>): void {
    clearTimeout(id);
    timers.delete(id);
  }

  function fontsReady(): Promise<void> {
    return new Promise((resolve) => {
      const fallback = later(resolve, FONT_WAIT_MS);
      const settle = () => {
        cancel(fallback);
        resolve();
      };
      try {
        Promise.all([
          document.fonts.load("600 1em Inter"),
          document.fonts.load("400 1em Inter"),
        ]).then(settle, settle);
      } catch {
        settle();
      }
    });
  }

  function run(): void {
    const schedule = createTypingSchedule(text, beatBeforeIndex);
    callbacks.onStart();
    schedule.keystrokes.forEach((time, index) => {
      later(() => callbacks.onType(index + 1), time);
    });
    later(callbacks.onBlink, schedule.blinkStart);
    schedule.caretToggles.forEach((time, index) => {
      later(() => callbacks.onCaret(index % 2 === 1), time);
    });
    later(callbacks.onDone, schedule.end);
  }

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    if (!typedWordmarkGate.take()) {
      callbacks.onDone();
      return;
    }
    void fontsReady().then(() => {
      if (!stopped) run();
    });
  });
  observer.observe(element);

  return () => {
    stopped = true;
    observer.disconnect();
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };
}
