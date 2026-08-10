import { describe, expect, it } from "vitest";
import { createAutosave } from "./autosave";
import { createTestClock } from "./testing/test-clock";

const debounceMs = 2_000;
const maxWaitMs = 30_000;

function setUp() {
  const clock = createTestClock();
  const saveTimes: number[] = [];
  const autosave = createAutosave({
    clock,
    debounceMs,
    maxWaitMs,
    save: () => saveTimes.push(clock.now()),
  });
  return { clock, saveTimes, autosave };
}

describe("createAutosave", () => {
  it("saves exactly 2000ms after a single edit, not before", () => {
    const { clock, saveTimes, autosave } = setUp();

    autosave.noteEdited();
    clock.advance(1_999);
    expect(saveTimes).toEqual([]);

    clock.advance(1);
    expect(saveTimes).toEqual([2_000]);
  });

  it("postpones the save while edits keep arriving, capped by the max wait, then starts a fresh window", () => {
    const { clock, saveTimes, autosave } = setUp();

    autosave.noteEdited();
    for (let i = 0; i < 29; i++) {
      clock.advance(1_000);
      autosave.noteEdited();
    }
    // Debounce alone would now be due at 31000, but the 30000 deadline wins.
    clock.advance(1_000);
    expect(saveTimes).toEqual([30_000]);

    autosave.noteEdited();
    for (let i = 0; i < 29; i++) {
      clock.advance(1_000);
      autosave.noteEdited();
    }
    clock.advance(1_000);
    expect(saveTimes).toEqual([30_000, 60_000]);
  });

  it("saveNow saves immediately and cancels the pending timers", () => {
    const { clock, saveTimes, autosave } = setUp();

    autosave.noteEdited();
    clock.advance(500);
    autosave.saveNow();
    expect(saveTimes).toEqual([500]);

    clock.advance(2_000);
    expect(saveTimes).toEqual([500]);
  });

  it("saveNow saves even when nothing was scheduled", () => {
    const { saveTimes, autosave } = setUp();

    autosave.saveNow();
    expect(saveTimes).toEqual([0]);
  });

  it("cancel prevents the scheduled save", () => {
    const { clock, saveTimes, autosave } = setUp();

    autosave.noteEdited();
    clock.advance(1_000);
    autosave.cancel();
    clock.advance(2_000);
    expect(saveTimes).toEqual([]);
  });

  it("dispose prevents saves from later noteEdited or saveNow calls", () => {
    const { clock, saveTimes, autosave } = setUp();

    autosave.noteEdited();
    clock.advance(1_000);
    autosave.dispose();

    autosave.noteEdited();
    clock.advance(30_000);
    expect(saveTimes).toEqual([]);

    autosave.saveNow();
    expect(saveTimes).toEqual([]);
  });

  it("scheduled reflects whether a timer is pending", () => {
    const { clock, autosave } = setUp();

    expect(autosave.scheduled).toBe(false);

    autosave.noteEdited();
    expect(autosave.scheduled).toBe(true);

    clock.advance(debounceMs);
    expect(autosave.scheduled).toBe(false);

    autosave.noteEdited();
    expect(autosave.scheduled).toBe(true);
    autosave.cancel();
    expect(autosave.scheduled).toBe(false);

    autosave.noteEdited();
    expect(autosave.scheduled).toBe(true);
    autosave.dispose();
    expect(autosave.scheduled).toBe(false);
  });
});
