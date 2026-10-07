import { describe, expect, it } from "vitest";
import {
  CARET_BLINK_MS,
  CARET_SOFT_EDGE_MS,
  TYPING_LEAD_IN_MS,
  createTypingSchedule,
} from "./typing-schedule";

const TEXT = "commitnote";
const BEAT_INDEX = 6;

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function span(keystrokes: number[]): number {
  return keystrokes[keystrokes.length - 1] - keystrokes[0];
}

function intervals(keystrokes: number[]): number[] {
  return keystrokes.slice(1).map((time, i) => time - keystrokes[i]);
}

describe("createTypingSchedule", () => {
  it("has one keystroke per letter", () => {
    const schedule = createTypingSchedule(TEXT, BEAT_INDEX, mulberry32(1));

    expect(schedule.keystrokes).toHaveLength(TEXT.length);
  });

  it("starts typing after the lead-in", () => {
    const schedule = createTypingSchedule(TEXT, BEAT_INDEX, mulberry32(2));

    expect(schedule.keystrokes[0]).toBe(TYPING_LEAD_IN_MS);
    expect(TYPING_LEAD_IN_MS).toBe(120);
  });

  it.each([
    ["always 0", () => 0],
    ["always 0.999999", () => 0.999999],
    ["always 0.5", () => 0.5],
  ])("keeps the typing span within bounds for random %s", (_, random) => {
    const schedule = createTypingSchedule(TEXT, BEAT_INDEX, random);

    expect(span(schedule.keystrokes)).toBeGreaterThanOrEqual(800);
    expect(span(schedule.keystrokes)).toBeLessThanOrEqual(1400);
  });

  it("keeps the typing span within bounds for many seeded sequences", () => {
    for (let seed = 0; seed < 500; seed++) {
      const schedule = createTypingSchedule(
        TEXT,
        BEAT_INDEX,
        mulberry32(seed),
      );

      expect(span(schedule.keystrokes)).toBeGreaterThanOrEqual(800);
      expect(span(schedule.keystrokes)).toBeLessThanOrEqual(1400);
    }
  });

  it("produces strictly increasing integer keystrokes", () => {
    for (let seed = 0; seed < 200; seed++) {
      const { keystrokes } = createTypingSchedule(
        TEXT,
        BEAT_INDEX,
        mulberry32(seed),
      );

      for (const time of keystrokes) {
        expect(Number.isInteger(time)).toBe(true);
      }
      for (const interval of intervals(keystrokes)) {
        expect(interval).toBeGreaterThan(0);
      }
    }
  });

  it("pauses longest before the beat index", () => {
    const { keystrokes } = createTypingSchedule(TEXT, BEAT_INDEX, () => 0.5);
    const gaps = intervals(keystrokes);
    const beatGap = gaps[BEAT_INDEX - 1];

    gaps.forEach((gap, i) => {
      if (i !== BEAT_INDEX - 1) expect(beatGap).toBeGreaterThan(gap);
    });
  });

  it("pauses longer before the beat index than its neighbours on average", () => {
    const sums = { before: 0, beat: 0, after: 0 };
    const runs = 300;
    for (let seed = 0; seed < runs; seed++) {
      const gaps = intervals(
        createTypingSchedule(TEXT, BEAT_INDEX, mulberry32(seed)).keystrokes,
      );
      sums.before += gaps[BEAT_INDEX - 2];
      sums.beat += gaps[BEAT_INDEX - 1];
      sums.after += gaps[BEAT_INDEX];
    }

    expect(sums.beat / runs).toBeGreaterThan(sums.before / runs);
    expect(sums.beat / runs).toBeGreaterThan(sums.after / runs);
  });

  it("starts blinking at the last keystroke", () => {
    const schedule = createTypingSchedule(TEXT, BEAT_INDEX, mulberry32(3));

    expect(schedule.blinkStart).toBe(
      schedule.keystrokes[schedule.keystrokes.length - 1],
    );
  });

  it("blinks the caret twice at the native cadence, hides it and then ends", () => {
    const schedule = createTypingSchedule(TEXT, BEAT_INDEX, mulberry32(4));
    const last = schedule.keystrokes[schedule.keystrokes.length - 1];

    expect(CARET_BLINK_MS).toBe(530);
    expect(schedule.caretToggles).toEqual([
      last + 530,
      last + 1060,
      last + 1590,
      last + 2120,
      last + 2650,
    ]);
    expect(schedule.end).toBe(last + 2650 + CARET_SOFT_EDGE_MS);
  });

  it("is deterministic for the same random source", () => {
    const first = createTypingSchedule(TEXT, BEAT_INDEX, mulberry32(42));
    const second = createTypingSchedule(TEXT, BEAT_INDEX, mulberry32(42));

    expect(second).toEqual(first);
  });

  it("counts letters rather than UTF-16 units", () => {
    const schedule = createTypingSchedule("a😀b", 1, mulberry32(5));

    expect(schedule.keystrokes).toHaveLength(3);
  });

  it("rejects empty text", () => {
    expect(() => createTypingSchedule("", 0, mulberry32(6))).toThrow();
  });
});
