import { describe, expect, it } from "vitest";
import { CLOSE_GUARD_TIMEOUT_MS, createCloseGuard, type CloseGuardDeps } from "./close-guard";

function createWindow(options: { unsaved?: boolean; timeoutMs?: number } = {}) {
  const listeners = new Set<() => void>();
  const timers = new Set<{ run: () => void; ms: number }>();
  const answers: Array<(quit: boolean) => void> = [];
  const win = {
    unsaved: options.unsaved ?? false,
    settled: false,
    flushes: 0,
    questions: 0,
    destroys: 0,
    onFlush: () => {},
    get listenerCount() {
      return listeners.size;
    },
    get timerCount() {
      return timers.size;
    },
    get timerDelays() {
      return [...timers].map((timer) => timer.ms);
    },
    emit() {
      for (const listener of [...listeners]) listener();
    },
    fireTimers() {
      for (const timer of [...timers]) timer.run();
    },
    answer(quit: boolean) {
      const pending = answers.shift();
      if (!pending) throw new Error("no pending question");
      pending(quit);
    },
  };
  const deps: CloseGuardDeps = {
    hasUnsaved: () => win.unsaved,
    flush: () => {
      win.flushes += 1;
      win.onFlush();
    },
    onUnsavedChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hasSettledUnsaved: () => win.settled,
    confirmQuit: () => {
      win.questions += 1;
      return new Promise<boolean>((resolve) => answers.push(resolve));
    },
    destroy: () => {
      win.destroys += 1;
    },
    timeoutMs: options.timeoutMs,
    setTimer: (run, ms) => {
      const timer = { run, ms };
      timers.add(timer);
      return () => timers.delete(timer);
    },
  };
  return { win, guard: createCloseGuard(deps) };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("close guard", () => {
  it("destroys at once when nothing is unsaved", async () => {
    const { win, guard } = createWindow();
    await guard.requestClose();
    expect(win.destroys).toBe(1);
    expect(win.flushes).toBe(0);
    expect(win.questions).toBe(0);
    expect(win.listenerCount).toBe(0);
    expect(win.timerCount).toBe(0);
  });

  it("destroys without waiting when the flush saves synchronously", async () => {
    const { win, guard } = createWindow({ unsaved: true });
    win.onFlush = () => {
      win.unsaved = false;
    };
    await guard.requestClose();
    expect(win.flushes).toBe(1);
    expect(win.destroys).toBe(1);
    expect(win.questions).toBe(0);
    expect(win.listenerCount).toBe(0);
    expect(win.timerCount).toBe(0);
  });

  it("flushes and destroys once the save completes", async () => {
    const { win, guard } = createWindow({ unsaved: true });
    const closing = guard.requestClose();
    expect(win.flushes).toBe(1);
    expect(win.listenerCount).toBe(1);
    expect(win.timerDelays).toEqual([CLOSE_GUARD_TIMEOUT_MS]);

    win.emit();
    await settle();
    expect(win.destroys).toBe(0);

    win.unsaved = false;
    win.emit();
    await closing;
    expect(win.destroys).toBe(1);
    expect(win.questions).toBe(0);
    expect(win.listenerCount).toBe(0);
    expect(win.timerCount).toBe(0);
  });

  it("asks right after flushing when unsaved work is already settled", async () => {
    const { win, guard } = createWindow({ unsaved: true });
    win.settled = true;
    const closing = guard.requestClose();
    await settle();
    expect(win.questions).toBe(1);
    expect(win.listenerCount).toBe(0);
    expect(win.timerCount).toBe(0);

    win.answer(true);
    await closing;
    expect(win.destroys).toBe(1);
  });

  it("destroys when the user quits after the save settles with unsaved work", async () => {
    const { win, guard } = createWindow({ unsaved: true });
    const closing = guard.requestClose();
    win.settled = true;
    win.emit();
    await settle();
    expect(win.questions).toBe(1);
    expect(win.listenerCount).toBe(0);
    expect(win.timerCount).toBe(0);
    expect(win.destroys).toBe(0);

    win.answer(true);
    await closing;
    expect(win.destroys).toBe(1);
  });

  it("stays open when the user cancels and starts over on the next request", async () => {
    const { win, guard } = createWindow({ unsaved: true });
    const first = guard.requestClose();
    win.settled = true;
    win.emit();
    await settle();
    win.answer(false);
    await first;
    expect(win.destroys).toBe(0);
    expect(win.listenerCount).toBe(0);
    expect(win.timerCount).toBe(0);

    win.settled = false;
    const second = guard.requestClose();
    expect(win.flushes).toBe(2);
    expect(win.listenerCount).toBe(1);
    expect(win.timerCount).toBe(1);

    win.unsaved = false;
    win.emit();
    await second;
    expect(win.destroys).toBe(1);
    expect(win.questions).toBe(1);
  });

  it("asks when the save does not finish before the timeout", async () => {
    const { win, guard } = createWindow({ unsaved: true, timeoutMs: 500 });
    const closing = guard.requestClose();
    expect(win.timerDelays).toEqual([500]);

    win.fireTimers();
    await settle();
    expect(win.questions).toBe(1);
    expect(win.listenerCount).toBe(0);
    expect(win.timerCount).toBe(0);

    win.answer(true);
    await closing;
    expect(win.destroys).toBe(1);
  });

  it("ignores repeated close requests while one is in progress", async () => {
    const { win, guard } = createWindow({ unsaved: true });
    const first = guard.requestClose();
    expect(guard.requestClose()).toBe(first);
    expect(win.flushes).toBe(1);
    expect(win.listenerCount).toBe(1);
    expect(win.timerCount).toBe(1);

    win.fireTimers();
    await settle();
    expect(guard.requestClose()).toBe(first);
    expect(win.flushes).toBe(1);
    expect(win.questions).toBe(1);

    win.answer(true);
    await first;
    expect(win.destroys).toBe(1);
  });

  it("stops waiting on dispose and never destroys or asks", async () => {
    const { win, guard } = createWindow({ unsaved: true });
    const closing = guard.requestClose();
    guard.dispose();
    await closing;
    expect(win.listenerCount).toBe(0);
    expect(win.timerCount).toBe(0);

    win.unsaved = false;
    win.emit();
    await settle();
    expect(win.destroys).toBe(0);
    expect(win.questions).toBe(0);

    await guard.requestClose();
    expect(win.destroys).toBe(0);
    expect(win.flushes).toBe(1);
  });

  it("does not destroy when disposed while the question is open", async () => {
    const { win, guard } = createWindow({ unsaved: true });
    win.settled = true;
    const closing = guard.requestClose();
    await settle();
    guard.dispose();
    win.answer(true);
    await closing;
    expect(win.destroys).toBe(0);
  });

  it("destroys at most once", async () => {
    const { win, guard } = createWindow();
    await guard.requestClose();
    await guard.requestClose();
    expect(win.destroys).toBe(1);
  });
});
